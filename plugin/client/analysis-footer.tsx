import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import type { PluginSurfaceProps } from '@getpaseo/plugin/client';
import { LiveStatus } from './live-status.js';

// 좌측 하단 아이콘에서 사용량·에이전트 모달을 열고 닫을 때 조회 화면도 해제한다.
export function AnalysisFooter(props: PluginSurfaceProps) {
    const [open, setOpen] = useState(false);
    const colors = props.theme.colors;
    // 좌측 하단 도구줄의 기존 아이콘 버튼 크기(데스크톱 28/16, 모바일 40/20)에 맞춘다.
    const compact = props.layout?.compact === true;
    const buttonSize = compact ? 40 : 28;
    return <>
        <Pressable accessibilityRole="button" accessibilityLabel="AI 사용량·에이전트 분석"
            onPress={() => setOpen(true)} style={{ width: buttonSize, height: buttonSize, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="Activity" size={compact ? 20 : 16} color={colors.foregroundMuted ?? colors.foreground} />
        </Pressable>
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
            {open && <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                <View accessibilityViewIsModal style={{ width: '94%', maxWidth: 1100, height: '88%',
                    backgroundColor: colors.surface0, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
                        backgroundColor: colors.surface1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
                            <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                                backgroundColor: colors.accent }}>
                                <Icon name="Activity" size={16} color={colors.accentForeground} />
                            </View>
                            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 17, fontWeight: '600', flexShrink: 1 }}>
                                AI 사용량·에이전트 분석</Text>
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel="분석 모달 닫기"
                            onPress={() => setOpen(false)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                                borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ color: colors.foreground, fontSize: 13 }}>닫기</Text>
                        </Pressable>
                    </View>
                    <LiveStatus {...props} initialTab="usage" />
                </View>
            </View>}
        </Modal>
    </>;
}
