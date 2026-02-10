export default function SnapshotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ margin: 0, padding: 0, minHeight: "100vh" }}>
      {children}
    </div>
  );
}
