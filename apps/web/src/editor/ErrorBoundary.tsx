import { Component, type ReactNode } from 'react';

/** 畫布崩潰不影響側欄，並提供「回到上次儲存」（03 §8） */
export class CanvasBoundary extends Component<
  { fallback: (reset: () => void, error: Error) => ReactNode; children: ReactNode; resetKey: unknown },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render() {
    return this.state.error
      ? this.props.fallback(() => this.setState({ error: null }), this.state.error)
      : this.props.children;
  }
}
