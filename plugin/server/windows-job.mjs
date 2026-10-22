import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Windows has no cgroups or process groups that survive reparenting. Each
 * session engine therefore runs under a tiny helper that owns a Job Object
 * with KILL_ON_JOB_CLOSE: the engine starts suspended, joins the job, then
 * resumes. Whenever the helper exits (normal exit, taskkill, crash) the last
 * job handle closes and the kernel terminates every descendant shell.
 * The helper is C# 5 so the csc.exe bundled with .NET Framework 4.x builds it
 * without extra dependencies.
 */
export const WINDOWS_JOB_SOURCE = String.raw`using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

internal static class PaseoDogJob
{
    const uint JobObjectLimitKillOnJobClose = 0x2000;
    const int ExtendedLimitInformationClass = 9;
    const uint CreateSuspended = 0x4;
    const int StartfUseStdHandles = 0x100;
    const uint HandleFlagInherit = 0x1;
    const uint Infinite = 0xFFFFFFFF;
    const uint WaitFailed = 0xFFFFFFFF;
    const uint ResumeFailed = 0xFFFFFFFF;
    const int StdInputHandle = -10;
    const int StdOutputHandle = -11;
    const int StdErrorHandle = -12;

    [StructLayout(LayoutKind.Sequential)]
    struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JobObjectExtendedLimitInformation info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
        ref StartupInfo startupInfo, out ProcessInformation processInformation);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    // 인자 검사 -> 실행, 실패 메시지는 stderr로만 남긴다
    static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("usage: paseodog-job <command> [arguments...]");
            return 2;
        }
        try { return Run(args); }
        catch (Exception error)
        {
            Console.Error.WriteLine("paseodog-job: " + error.Message);
            return 1;
        }
    }

    // Job 생성 -> 엔진 일시정지 시작 -> Job 배정 -> 재개 -> 종료 대기 -> 종료 코드 전달
    static int Run(string[] args)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        JobObjectExtendedLimitInformation limits = new JobObjectExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        if (!SetInformationJobObject(job, ExtendedLimitInformationClass, ref limits,
            (uint)Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation)))) throw new Win32Exception();

        StringBuilder commandLine = new StringBuilder();
        foreach (string argument in args) AppendArgument(commandLine, argument);

        StartupInfo startup = new StartupInfo();
        startup.cb = Marshal.SizeOf(typeof(StartupInfo));
        startup.dwFlags = StartfUseStdHandles;
        startup.hStdInput = InheritableStdHandle(StdInputHandle);
        startup.hStdOutput = InheritableStdHandle(StdOutputHandle);
        startup.hStdError = InheritableStdHandle(StdErrorHandle);

        ProcessInformation child;
        if (!CreateProcess(null, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended,
            IntPtr.Zero, null, ref startup, out child)) throw new Win32Exception();
        if (!AssignProcessToJobObject(job, child.hProcess))
        {
            Win32Exception error = new Win32Exception();
            TerminateProcess(child.hProcess, 1);
            throw error;
        }
        if (ResumeThread(child.hThread) == ResumeFailed) throw new Win32Exception();
        CloseHandle(child.hThread);
        if (WaitForSingleObject(child.hProcess, Infinite) == WaitFailed) throw new Win32Exception();
        uint exitCode;
        if (!GetExitCodeProcess(child.hProcess, out exitCode)) throw new Win32Exception();
        // 프로세스 종료 시 Job 핸들이 닫혀 남은 하위 프로세스도 커널이 종료한다.
        return unchecked((int)exitCode);
    }

    // 표준 입출력 핸들을 자식이 상속하도록 표시
    static IntPtr InheritableStdHandle(int id)
    {
        IntPtr handle = GetStdHandle(id);
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return handle;
        if (!SetHandleInformation(handle, HandleFlagInherit, HandleFlagInherit)) throw new Win32Exception();
        return handle;
    }

    // CommandLineToArgvW 규칙에 맞춰 인자 하나를 인용해 추가
    static void AppendArgument(StringBuilder builder, string argument)
    {
        if (builder.Length > 0) builder.Append(' ');
        if (argument.Length > 0 && argument.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            builder.Append(argument);
            return;
        }
        builder.Append('"');
        int backslashes = 0;
        foreach (char character in argument)
        {
            if (character == '\\') { backslashes++; continue; }
            if (character == '"') builder.Append('\\', backslashes * 2 + 1);
            else builder.Append('\\', backslashes);
            builder.Append(character);
            backslashes = 0;
        }
        builder.Append('\\', backslashes * 2);
        builder.Append('"');
    }
}
`;

const SOURCE_DIGEST = createHash('sha256').update(WINDOWS_JOB_SOURCE).digest('hex').slice(0, 16);

// 소스 해시별 헬퍼 경로 (상태 디렉터리 -> bin/paseodog-job-<해시>.exe)
export function windowsJobHelperPath(stateDir) {
    return join(stateDir, 'bin', `paseodog-job-${SOURCE_DIGEST}.exe`);
}

// .NET Framework 4.x 기본 C# 컴파일러 경로
export function windowsCompilerPath(env = process.env) {
    return join(env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
}

// 헬퍼가 없으면 임시 파일로 컴파일 -> 원자적 이동 (동시 세션이 먼저 만들었으면 그대로 사용)
export async function ensureWindowsJobHelper({ stateDir, runCommand, env = process.env }) {
    const helper = windowsJobHelperPath(stateDir);
    if (existsSync(helper)) return helper;
    await mkdir(dirname(helper), { recursive: true });
    const stem = join(dirname(helper), `.build-${randomUUID()}`);
    const source = `${stem}.cs`, output = `${stem}.exe`;
    try {
        await writeFile(source, WINDOWS_JOB_SOURCE, { flag: 'wx' });
        try {
            await runCommand(windowsCompilerPath(env), ['/nologo', '/target:exe', '/optimize+', `/out:${output}`, source],
                { env, timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
        } catch (error) {
            const detail = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || error || ''}`.trim();
            throw new Error(`Unable to build the PaseoDog Windows job helper: ${detail.slice(0, 600)}`);
        }
        try { await rename(output, helper); }
        catch (error) { if (!existsSync(helper)) throw error; }
    } finally {
        await rm(source, { force: true });
        await rm(output, { force: true });
    }
    return helper;
}

// Windows 세션 격리 범위 (헬퍼 -> Job Object -> 엔진 --stdio)
export function createWindowsJobScope({ launch, runCommand, ensureHelper = ensureWindowsJobHelper }) {
    const stateDir = launch.env?.PASEODOG_STATE_DIR;
    if (!stateDir) throw new Error('PASEODOG_STATE_DIR is required for Windows job containment');
    return {
        kind: 'windows-job', unit: null, detached: false,
        command: windowsJobHelperPath(stateDir),
        args: [launch.command, ...(launch.args || []), '--stdio'],
        // Fail closed: never launch the engine without its kill-on-close job.
        async preflight() { await ensureHelper({ stateDir, runCommand }); },
        // Killing the helper (taskkill /T /F) closes the job and every descendant.
        stop: null,
    };
}
