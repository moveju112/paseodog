import { describe, expect, it, vi } from "vitest";
import { setAgentFeatureAndRemember, setAgentThinkingOptionAndRemember } from "./live-agent-preferences";
import { CreateAgentPreferencesService } from "./service";
import { FakeCreateAgentPreferenceStorage } from "./test-utils/fake-preference-storage";

describe("confirmed live effort preferences", () => {
    it("does not save pending or rejected session changes", async () => {
        const saved = {
            provider: "paseodog",
            providerPreferences: { paseodog: { model: "test/model", thinkingByModel: { "test/model": "high" } } },
        };
        const storage = new FakeCreateAgentPreferenceStorage({ stored: saved });
        const service = new CreateAgentPreferencesService(storage);
        let reject!: (error: Error) => void;
        const client = {
            setAgentThinkingOption: vi.fn(() => new Promise<null>((_resolve, fail) => { reject = fail; })),
        };
        const selection = setAgentThinkingOptionAndRemember({
            client, agentId: "agent", provider: "paseodog", modelId: "test/model",
            thinkingOptionId: "low", updatePreferences: (update) => service.update(update),
        });
        expect(storage.pendingWriteCount()).toBe(0);
        const rejected = expect(selection).rejects.toThrow("busy");
        reject(new Error("busy"));
        await rejected;
        expect(await service.load()).toEqual(saved);
        expect(storage.savedPreferences()).toEqual(saved);
        expect(storage.pendingWriteCount()).toBe(0);
    });

    it("remembers the manual baseline only after session success and reports storage failure", async () => {
        const storage = new FakeCreateAgentPreferenceStorage();
        const service = new CreateAgentPreferencesService(storage);
        let resolve!: (value: null) => void;
        const client = {
            setAgentThinkingOption: vi.fn(() => new Promise<null>((accept) => { resolve = accept; })),
        };
        const input = {
            client, agentId: "agent", provider: "paseodog", modelId: "test/model",
            thinkingOptionId: "low", updatePreferences: (update: Parameters<typeof service.update>[0]) => service.update(update),
        };
        const selection = setAgentThinkingOptionAndRemember(input);
        expect(storage.pendingWriteCount()).toBe(0);
        resolve(null);
        await storage.nextWrite();
        storage.finishOldestWrite();
        await selection;
        expect(storage.savedPreferences()).toEqual({
            provider: "paseodog",
            providerPreferences: { paseodog: { model: "test/model", thinkingByModel: { "test/model": "low" } } },
        });
        const failedSave = setAgentThinkingOptionAndRemember({ ...input, thinkingOptionId: "high" });
        const rejected = expect(failedSave).rejects.toThrow("disk full");
        resolve(null);
        await storage.nextWrite();
        storage.failOldestWrite(new Error("disk full"));
        await rejected;
        expect((await service.load()).providerPreferences?.paseodog?.thinkingByModel)
            .toEqual({ "test/model": "low" });
    });
});

describe("confirmed live feature preferences", () => {
    it("leaves future preferences unchanged while pending and after rejection without replay", async () => {
        const saved = {
            provider: "paseodog",
            providerPreferences: {
                paseodog: { model: "test/model", featureValues: { fast: false, autoEffort: true } },
            },
        };
        const storage = new FakeCreateAgentPreferenceStorage({ stored: saved });
        const service = new CreateAgentPreferencesService(storage);
        let reject!: (error: Error) => void;
        const client = {
            setAgentFeature: vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; })),
        };
        const selection = setAgentFeatureAndRemember({
            client, agentId: "agent", provider: "paseodog", featureId: "fast", value: true,
            updatePreferences: (update) => service.update(update),
        });
        expect(storage.pendingWriteCount()).toBe(0);
        expect(await service.load()).toEqual(saved);
        const rejected = expect(selection).rejects.toThrow("busy");
        reject(new Error("busy"));
        await rejected;
        expect(storage.pendingWriteCount()).toBe(0);
        expect(storage.savedPreferences()).toEqual(saved);
        expect(await service.load()).toEqual(saved);
        expect(client.setAgentFeature).toHaveBeenCalledExactlyOnceWith("agent", "fast", true);
    });

    it("persists an admitted feature only after confirmation and preserves other preferences", async () => {
        const storage = new FakeCreateAgentPreferenceStorage({ stored: {
            provider: "paseodog",
            providerPreferences: {
                paseodog: { model: "test/model", featureValues: { fast: false, autoEffort: true } },
            },
        } });
        const service = new CreateAgentPreferencesService(storage);
        let resolve!: () => void;
        const client = {
            setAgentFeature: vi.fn(() => new Promise<void>((accept) => { resolve = accept; })),
        };
        const selection = setAgentFeatureAndRemember({
            client, agentId: "agent", provider: "paseodog", featureId: "fast", value: true,
            updatePreferences: (update) => service.update(update),
        });
        expect(storage.pendingWriteCount()).toBe(0);
        resolve();
        await storage.nextWrite();
        storage.finishOldestWrite();
        await selection;
        expect(storage.savedPreferences()).toEqual({
            provider: "paseodog",
            providerPreferences: {
                paseodog: { model: "test/model", featureValues: { fast: true, autoEffort: true } },
            },
        });
        expect(client.setAgentFeature).toHaveBeenCalledExactlyOnceWith("agent", "fast", true);
    });
});
