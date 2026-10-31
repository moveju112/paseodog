import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { useRecentSessionsStore } from "./recent-sessions-store";

beforeEach(async () => {
  await useRecentSessionsStore.persist.rehydrate();
  useRecentSessionsStore.setState(useRecentSessionsStore.getInitialState());
});

describe("recent session hiding persistence", () => {
  it("preserves hidden entries across hydration and time-range changes", async () => {
    useRecentSessionsStore.getState().hideSession("host", "session", 123);
    useRecentSessionsStore.getState().hideSession("other", "session", 456);
    useRecentSessionsStore.getState().setWindow("12h");
    const saved = await AsyncStorage.getItem("sidebar-recent-sessions");
    expect(JSON.parse(saved!).state.hiddenThrough).toEqual({
      "host:session": 123,
      "other:session": 456,
    });
    useRecentSessionsStore.setState(useRecentSessionsStore.getInitialState());
    await AsyncStorage.setItem("sidebar-recent-sessions", saved!);
    await useRecentSessionsStore.persist.rehydrate();
    expect(useRecentSessionsStore.getState().hiddenThrough).toEqual({
      "host:session": 123,
      "other:session": 456,
    });
    expect(useRecentSessionsStore.getState().window).toBe("12h");
  });

  it("loads existing preferences without hidden entries", async () => {
    await AsyncStorage.setItem(
      "sidebar-recent-sessions",
      JSON.stringify({
        state: { window: "4h", windows: ["30m", "4h", "12h"] },
        version: 0,
      }),
    );
    await useRecentSessionsStore.persist.rehydrate();
    expect(useRecentSessionsStore.getState().hiddenThrough).toEqual({});
    expect(useRecentSessionsStore.getState().window).toBe("4h");
  });
});
