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
            {open && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                {/* 다른 모달과 같이 바깥 영역을 누르면 닫는다. 내용 영역은 뒤에 그려져 터치를 먼저 받는다. */}
                <Pressable accessibilityRole="button" accessibilityLabel="분석 모달 바깥 닫기" onPress={() => setOpen(false)}
                    style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                <View accessibilityViewIsModal style={{ width: '94%', maxWidth: 960, height: '88%',
                    backgroundColor: colors.surface0, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                        paddingLeft: 16, paddingRight: 8, paddingVertical: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
                            <Icon name="Activity" size={16} color={colors.accent} />
                            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: '600', flexShrink: 1 }}>
                                AI 사용량·에이전트 분석</Text>
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel="분석 모달 닫기"
                            onPress={() => setOpen(false)} style={{ width: 32, height: 32, borderRadius: 8,
                                alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: colors.foregroundMuted, fontSize: 18 }}>✕</Text>
                        </Pressable>
                    </View>
                    <LiveStatus {...props} initialTab="usage" />
                </View>
            </View>}
        </Modal>
    </>;
}
