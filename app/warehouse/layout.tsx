import RouteGuard from "../components/RouteGuard";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RouteGuard path="/warehouse">{children}</RouteGuard>;
}
