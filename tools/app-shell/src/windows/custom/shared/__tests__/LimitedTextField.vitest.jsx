// @covers tools/app-shell/src/windows/custom/shared/LimitedTextField.jsx
import { render, screen } from '@testing-library/react';

// The translator returns the key plus its params, so the tests can assert on what each
// message is told (used/max, the field name) without depending on locale wording.
vi.mock('@/i18n', () => ({
  useUI: () => (key, params) => (params
    ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`
    : key),
}));

import LimitedTextField from '../LimitedTextField.jsx';

const STYLES = {
  label: {},
  input: {},
  error: { color: 'rgb(200, 0, 0)' },
  counter: { color: 'rgb(0, 0, 200)' },
  counterOver: { color: 'rgb(255, 0, 0)' },
  hint: { color: 'rgb(0, 128, 0)' },
};

function renderField(props = {}) {
  return render(
    <LimitedTextField
      id="street"
      label="Calle"
      value=""
      max={5}
      onChange={vi.fn()}
      testId="street-input"
      styles={STYLES}
      {...props}
    />,
  );
}

function describedByIds() {
  return screen.getByTestId('street-input').getAttribute('aria-describedby').split(' ');
}

describe('LimitedTextField', () => {
  describe('counter', () => {
    it('renders used/max with the normal style below the limit', () => {
      renderField({ value: 'abc' });
      const counter = screen.getByTestId('street-input-counter');
      expect(counter).toHaveTextContent('charactersUsedCounter(used=3,max=5)');
      expect(counter).toHaveAttribute('id', 'street-counter');
      expect(counter).toHaveStyle({ color: 'rgb(0, 0, 200)' });
    });

    it('keeps the normal style at exactly max', () => {
      renderField({ value: 'abcde' });
      expect(screen.getByTestId('street-input-counter')).toHaveStyle({ color: 'rgb(0, 0, 200)' });
    });

    it('switches to the over style when the length exceeds max', () => {
      renderField({ value: 'abcdefg', maxLength: 10 });
      const counter = screen.getByTestId('street-input-counter');
      expect(counter).toHaveTextContent('charactersUsedCounter(used=7,max=5)');
      expect(counter).toHaveStyle({ color: 'rgb(255, 0, 0)' });
    });
  });

  describe('at-limit note', () => {
    it('renders as a polite live region at exactly max', () => {
      renderField({ value: 'abcde' });
      const note = screen.getByTestId('street-input-at-limit');
      expect(note).toHaveAttribute('role', 'status');
      expect(note).toHaveAttribute('aria-live', 'polite');
      expect(note).toHaveAttribute('id', 'street-at-limit');
      expect(note).toHaveTextContent('fieldMaxLengthReached(field=Calle,max=5)');
      expect(screen.queryByTestId('street-input-over-limit')).not.toBeInTheDocument();
      expect(screen.getByTestId('street-input')).toHaveAttribute('aria-invalid', 'false');
    });

    it('is absent below max', () => {
      renderField({ value: 'abcd' });
      expect(screen.queryByTestId('street-input-at-limit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('street-input-over-limit')).not.toBeInTheDocument();
    });
  });

  describe('over-limit message', () => {
    it('renders and marks the input invalid when the value exceeds max', () => {
      renderField({ value: 'abcdefg', maxLength: 10 });
      const msg = screen.getByTestId('street-input-over-limit');
      expect(msg).toHaveAttribute('role', 'status');
      expect(msg).toHaveAttribute('aria-live', 'polite');
      expect(msg).toHaveAttribute('id', 'street-over-limit');
      expect(msg).toHaveTextContent('fieldOverLimitMessage(field=Calle,max=5)');
      expect(screen.queryByTestId('street-input-at-limit')).not.toBeInTheDocument();
      expect(screen.getByTestId('street-input')).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('caller error', () => {
    it('renders the error and sets aria-invalid', () => {
      renderField({ value: '', error: 'fieldRequired' });
      const err = screen.getByText('fieldRequired');
      expect(err).toHaveAttribute('id', 'street-error');
      expect(screen.getByTestId('street-input')).toHaveAttribute('aria-invalid', 'true');
    });

    it('renders no error and leaves aria-invalid false without one', () => {
      renderField({ value: 'ab' });
      expect(document.getElementById('street-error')).toBeNull();
      expect(screen.getByTestId('street-input')).toHaveAttribute('aria-invalid', 'false');
    });
  });

  describe('aria-describedby', () => {
    it('references only the counter when no message is shown', () => {
      renderField({ value: 'ab' });
      expect(describedByIds()).toEqual(['street-counter']);
    });

    it('adds the at-limit id at exactly max', () => {
      renderField({ value: 'abcde' });
      expect(describedByIds()).toEqual(['street-counter', 'street-at-limit']);
    });

    it('adds the error and over-limit ids when both are shown', () => {
      renderField({ value: 'abcdefg', maxLength: 10, error: 'bad' });
      expect(describedByIds()).toEqual(['street-counter', 'street-error', 'street-over-limit']);
    });

    it('every referenced id exists in the DOM', () => {
      renderField({ value: 'abcde', error: 'bad' });
      for (const id of describedByIds()) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    });
  });

  describe('input wiring', () => {
    it('falls back to max for maxLength when none is given', () => {
      renderField({ value: 'a' });
      expect(screen.getByTestId('street-input')).toHaveAttribute('maxLength', '5');
    });

    it('uses the explicit maxLength when given', () => {
      renderField({ value: 'a', maxLength: 12 });
      expect(screen.getByTestId('street-input')).toHaveAttribute('maxLength', '12');
    });

    it('uses testId as the input data-testid and id as its id', () => {
      renderField({ value: 'xyz' });
      const input = screen.getByTestId('street-input');
      expect(input.tagName).toBe('INPUT');
      expect(input).toHaveAttribute('id', 'street');
      expect(input).toHaveValue('xyz');
    });

    it('forwards inputProps to the input', () => {
      renderField({ inputProps: { autoComplete: 'address-line1', name: 'streetName' } });
      const input = screen.getByTestId('street-input');
      expect(input).toHaveAttribute('autocomplete', 'address-line1');
      expect(input).toHaveAttribute('name', 'streetName');
    });

    it('ignores an unknown data-testid prop so the input keeps testId', () => {
      renderField({ 'data-testid': 'LimitedTextField__codemod' });
      expect(screen.getByTestId('street-input').tagName).toBe('INPUT');
      expect(screen.queryByTestId('LimitedTextField__codemod')).not.toBeInTheDocument();
    });
  });

  describe('required mark', () => {
    it('renders the mark when required', () => {
      renderField({ required: true });
      expect(screen.getByTestId('RequiredMark__927831')).toHaveTextContent('*');
    });

    it('omits the mark when not required', () => {
      renderField();
      expect(screen.queryByTestId('RequiredMark__927831')).not.toBeInTheDocument();
    });
  });
});
