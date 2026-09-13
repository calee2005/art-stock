import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  CORS_ERROR_MESSAGE,
  corsExampleJson,
  isCorsFailure,
} from "./cors.ts";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Uncaught render/network errors must not leave a white screen on Pages.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.setState({ error });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    const cors = isCorsFailure(error);
    return (
      <div
        data-testid="app-error"
        role="alert"
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 720,
          margin: "2rem auto",
          padding: "1rem",
          background: "#fef2f2",
        }}
      >
        <h1>页面出错</h1>
        <p data-testid={cors ? "cors-error" : undefined}>
          {cors ? CORS_ERROR_MESSAGE : error.message}
        </p>
        {cors ? (
          <pre data-testid="cors-json">{corsExampleJson()}</pre>
        ) : null}
        <p>远端配置表仍可在刷新后重新填写。密钥只存在本机，构建产物不含密钥。</p>
      </div>
    );
  }
}
