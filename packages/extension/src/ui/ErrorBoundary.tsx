import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence for every React root in the extension.
 *
 * Without one, a single throw in a render or an effect unmounts the whole tree
 * and leaves a blank white page — no message, no way to recover, nothing to
 * report. For a settings page that is annoying; for the caption overlay it
 * means the user's captions vanish mid-call with no explanation, which is the
 * worst failure this product has.
 *
 * Showing something broken beats showing nothing.
 */
interface Props {
  children: ReactNode;
  /** Named in the fallback so a bug report says which surface failed. */
  surface: string;
  compact?: boolean;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[slb] ${this.props.surface} crashed`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          padding: this.props.compact ? '10px 12px' : '16px 20px',
          font: '13px/1.5 system-ui, sans-serif',
          color: '#ffc9c4',
          background: 'rgba(255,138,128,0.14)',
          border: '1px solid rgba(255,138,128,0.4)',
          borderRadius: 8,
        }}
      >
        <b>Something went wrong in the {this.props.surface}.</b>
        <div style={{ marginTop: 4, opacity: 0.9 }}>{error.message}</div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            marginTop: 10,
            font: 'inherit',
            fontWeight: 600,
            padding: '6px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'transparent',
            color: 'inherit',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
