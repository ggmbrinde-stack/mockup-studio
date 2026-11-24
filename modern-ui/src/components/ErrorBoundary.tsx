import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  /** null means "no error"; a message means the fallback is showing. */
  message: string | null;
}

/* A render error used to leave the whole panel blank. This keeps the failure on screen with a
   way out. Only render/lifecycle failures below this point are caught — event-handler and
   async errors propagate as usual, and React still logs the error and its component stack. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    /* No String() here: a thrown object with a throwing toString() would fail inside React's
       own error handling and blank the panel anyway. */
    return { message: error instanceof Error && error.message ? error.message : "Unknown error" };
  }

  render() {
    const message = this.state.message;
    if (message === null) return this.props.children;
    return (
      <div className="app">
        <div className="error-box" role="alert">
          <span className="errorText">The panel hit an error: {message}</span>
          <button className="btn small errorDismiss" type="button" onClick={() => location.reload()}>
            Reload panel
          </button>
        </div>
        <div className="hint">If it happens again, close and reopen the panel from Window &gt; Extensions.</div>
      </div>
    );
  }
}
