import React from 'react';
import {useUI} from '@/i18n';
import RequiredMark from '@/components/ui/required-mark.jsx';

/**
 * ETP-5806 CP-6 / CP-13 — a text input whose length limit is COMMUNICATED instead of silently
 * enforced.
 *
 * <p>The bug this exists to stop repeating: a bare `maxLength` drops every character past the cap
 * with no feedback at all. The user pastes a long street, watches the value stop mid-word, and has
 * no way to learn why. CP-6 fixed that for Calle by hand; QA then found Número and Edificio still
 * doing it in the very same modal, and the onboarding company step doing it a third time. Three
 * copies of the same three elements is how the next field gets forgotten, so the pattern lives
 * here.
 *
 * <p>Two distinct states, deliberately worded differently:
 * - `atLimit` (length === max) — reachable by typing. An informational note: "you have reached the
 *   limit", so the next keystroke being swallowed is expected rather than mysterious.
 * - `overLimit` (length > max) — only reachable when `maxLength` leaves headroom above `max` (the
 *   onboarding company step, where the AD column is wider than the composer's cap) or when the
 *   value arrived from the server (a record stored before the cap existed). An error, and the
 *   caller is expected to block its own Save/Continue on the same condition.
 *
 * <p><b>Accessibility (ETP-5806 N2).</b> The counter is NOT a live region: it changes on every
 * keystroke and announcing "31/60", "32/60"… would bury everything else. It is wired into the
 * input's `aria-describedby` instead, so a screen reader reads the remaining budget when the field
 * takes focus, which is the moment it is useful. The two messages ARE live (`role="status"` /
 * `aria-live="polite"`) because they appear on a state change the user did not ask for, and the
 * over-limit one is what explains a disabled Save. `aria-invalid` tracks over-limit or a
 * caller-supplied error.
 *
 * @param {string}  id          input id; also the prefix of every message's id
 * @param {string}  label       the field's visible label — ALSO interpolated into both limit
 *                              messages, so it must be the translated name, not a key
 * @param {boolean} required    renders the required mark
 * @param {string}  value       the controlled value
 * @param {number}  max         the ENFORCED cap: what the counter counts against and what both
 *                              messages name
 * @param {number}  [maxLength] the input's own hard stop; defaults to `max`. Pass a looser value
 *                              (never looser than the storage column) to make `overLimit`
 *                              reachable by typing instead of truncating silently
 * @param {string}  [error]     a caller-owned error (e.g. "this field is required"), rendered
 *                              above the limit messages
 * @param {string}  testId      `data-testid` of the input; the messages derive theirs from it
 * @param {object}  styles      `{label, input, error, counter, counterOver, hint}` — the modal
 *                              owns its own look, this component owns only the structure
 */
export default function LimitedTextField({
    id, label, required = false, value = '', max, maxLength, onChange,
    placeholder, autoFocus = false, error = null, testId, styles, inputProps = {},
}) {
    const ui = useUI();
    const length = value.length;
    const overLimit = length > max;
    const atLimit = length === max;

    const counterId = `${id}-counter`;
    const errorId = `${id}-error`;
    const overId = `${id}-over-limit`;
    const atId = `${id}-at-limit`;
    const describedBy = [counterId, error ? errorId : null, overLimit ? overId : null,
        atLimit ? atId : null].filter(Boolean).join(' ');

    return (
        <div>
            <div style={{...styles.label, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8}}>
                <span>{label}{required && <RequiredMark data-testid="RequiredMark__927831" />}</span>
                <span
                    id={counterId}
                    style={overLimit ? styles.counterOver : styles.counter}
                    data-testid={`${testId}-counter`}
                >
                    {ui('charactersUsedCounter', {used: length, max})}
                </span>
            </div>
            <input
                id={id}
                type="text"
                autoFocus={autoFocus}
                maxLength={maxLength ?? max}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                aria-invalid={overLimit || Boolean(error)}
                aria-describedby={describedBy}
                data-testid={testId}
                style={styles.input}
                {...inputProps}
            />
            {error && (
                <div id={errorId} style={styles.error}>{error}</div>
            )}
            {overLimit && (
                <div id={overId} style={styles.error} role="status" aria-live="polite"
                     data-testid={`${testId}-over-limit`}>
                    {ui('fieldOverLimitMessage', {field: label, max})}
                </div>
            )}
            {atLimit && (
                <div id={atId} style={styles.hint} role="status" aria-live="polite"
                     data-testid={`${testId}-at-limit`}>
                    {ui('fieldMaxLengthReached', {field: label, max})}
                </div>
            )}
        </div>
    );
}
