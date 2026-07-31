import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui.tsx'

/**
 * Catch a render crash and show something recoverable.
 *
 * React unmounts the entire tree when a render throws, so without this one bad
 * field on one row — a malformed timestamp, a shape the server changed — takes
 * the whole console to a blank white page. That is the worst possible failure
 * for a monitoring tool: it looks exactly like "nothing is wrong".
 *
 * The reset path clears the URL rather than only the error, because the state
 * that crashed us is usually IN the URL (a device id that no longer exists, a
 * filter combination nothing satisfies). Retrying the same address would just
 * crash again and read as a dead app.
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry endpoint for the console itself — this is an internal tool
    // and the browser console is where whoever hit it will be looking.
    console.error('[fleet] render error:', error, info.componentStack)
  }

  private reset = (): void => {
    window.location.hash = '#/terminals'
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main className="login">
        <div className="login-card">
          <h1 className="view-title">Something broke on this screen</h1>
          <p className="login-lede">
            The console hit an error while rendering. The fleet itself is unaffected — terminals
            keep reporting and alerts keep firing whether or not this page is working.
          </p>
          <pre className="stack">{error.message}</pre>
          <Button variant="primary" className="btn-block" onClick={this.reset}>
            Back to Terminals
          </Button>
          <p className="login-foot">
            If it happens again, the details are in the browser console.
          </p>
        </div>
      </main>
    )
  }
}
