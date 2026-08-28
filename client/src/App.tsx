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

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/sale2"}>
        <Suspense fallback={<div className="min-h-screen" style={{ background: "#08081c" }} />}>
          <Sale2 />
        </Suspense>
      </Route>
      <Route path={"/erp"}>
        <Suspense fallback={<div className="min-h-screen" style={{ background: "#F7F9F6" }} />}>
          <ErpApp />
        </Suspense>
      </Route>
      <Route path={"/portfolio"}><Redirect to="/" /></Route>
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
