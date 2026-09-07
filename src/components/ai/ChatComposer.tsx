import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Bump after send from a prompt card so the box clears. */
  resetToken?: number;
}

/**
 * Local draft state on purpose. The chat sheet paints through SheetHost, so a
 * parent-controlled value round-trips every keystroke and drops characters.
 */
export function ChatComposer({
  onSend,
  disabled,
  placeholder = 'Message DriveIQ…',
  resetToken = 0,
}: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const inputRef = useRef<TextInput>(null);
  draftRef.current = draft;

  useEffect(() => {
    if (resetToken === 0) return;
    draftRef.current = '';
    setDraft('');
  }, [resetToken]);

  const canSend = draft.trim().length > 0 && !disabled;

  const submit = () => {
    const text = draftRef.current.trim();
    if (!text || disabled) return;
    draftRef.current = '';
    setDraft('');
    onSend(text);
  };

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}
      pointerEvents="auto"
    >
      <View style={styles.bar}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          value={draft}
          onChangeText={(text) => {
            draftRef.current = text;
            setDraft(text);
          }}
          onSubmitEditing={canSend ? submit : undefined}
          blurOnSubmit={false}
          returnKeyType="default"
          editable={!disabled}
          multiline
          scrollEnabled
          maxLength={800}
          autoCorrect
          autoCapitalize="sentences"
          textAlignVertical="top"
          keyboardAppearance="light"
        />
        <Pressable
          onPress={submit}
          style={[styles.send, !canSend && styles.sendOff]}
          disabled={!canSend}
          accessibilityLabel="Send message"
        >
          <Ionicons name="arrow-up" size={20} color={colors.textOnPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 26,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minHeight: 52,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
    paddingTop: 9,
    paddingBottom: 9,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendOff: {
    backgroundColor: colors.textSecondary,
    opacity: 0.35,
  },
});
