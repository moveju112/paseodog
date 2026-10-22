// 로컬 Apache-2.0 패치: 대화 되돌리기 뒤 강제 재수화가 잘린 턴을 다시 그리지 않게 한다.
// PluginAgentSession 기록은 append-only라 공급자가 대화를 잘라도 같은 메시지부터 버려야 한다.
export const REVERT_HISTORY_EDIT = [
    '            token,\n            scope,\n        });\n    }\n    publish(event) {\n',
    '            token,\n            scope,\n        });\n'
        + '        // 대화 범위 되돌리기는 대상 사용자 메시지부터 재수화 기록을 버린다.\n'
        + '        if (scope !== "files") {\n'
        + '            const index = this.history.findIndex((event) => event.type === "timeline" &&\n'
        + '                event.item.type === "user_message" && event.item.messageId === messageId);\n'
        + '            if (index >= 0)\n'
        + '                this.history.splice(index);\n'
        + '        }\n'
        + '    }\n    publish(event) {\n',
];
