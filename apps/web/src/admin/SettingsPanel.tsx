export function SettingsPanel(props: { username: string }) {
  return (
    <div className="settings-panel">
      <p className="admin-muted">系统设置建设中({props.username})</p>
    </div>
  );
}
