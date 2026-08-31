import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

const Sale2 = lazy(() => import("./pages/Sale2"));
const ErpApp = lazy(() => import("./pages/erp/ErpApp"));

/**
 * 경영관리 시스템은 admin.dinostudio.kr 로 씁니다.
 *
 * 같은 배포에서 호스트로 갈라집니다 — admin 호스트에서는 루트가 바로 경영관리 시스템이고,
 * 마케팅 사이트는 보이지 않습니다. 세션 쿠키는 호스트 전용이라 두 도메인이 서로 섞이지 않습니다.
 */
function isAdminHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "admin.dinostudio.kr" || host.startsWith("admin.");
}

function ErpRoute() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen" style={{ background: "#F7F9F6" }} />
      }
    >
      <ErpApp />
    </Suspense>
  );
}

function AdminRouter() {
  return (
    <Switch>
      <Route path={"/"} component={ErpRoute} />
      {/* 주소를 외워 둔 사람이 있으므로 /erp 도 그대로 연다 */}
      <Route path={"/erp"} component={ErpRoute} />
      <Route component={ErpRoute} />
    </Switch>
  );
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  if (isAdminHost()) return <AdminRouter />;

  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/sale2"}>
        <Suspense
          fallback={
            <div className="min-h-screen" style={{ background: "#08081c" }} />
          }
        >
          <Sale2 />
        </Suspense>
      </Route>
      <Route path={"/erp"} component={ErpRoute} />
      <Route path={"/portfolio"}>
        <Redirect to="/" />
      </Route>
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
