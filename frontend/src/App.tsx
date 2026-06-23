import { useEffect } from "react";
import Diagnostics from "./components/Diagnostics";
import FlowDetail from "./components/FlowDetail";
import FlowList from "./components/FlowList";
import InterceptEditor from "./components/InterceptEditor";
import InterceptScreen from "./components/InterceptScreen";
import ResendScreen from "./components/ResendScreen";
import RulesPanel from "./components/RulesPanel";
import Sidebar from "./components/Sidebar";
import { useStore } from "./store";
import { connectWs } from "./ws";

export default function App() {
  const wsConnected = useStore((s) => s.wsConnected);
  const mainView = useStore((s) => s.mainView);

  useEffect(() => {
    connectWs();
  }, []);

  return (
    <div className="flex h-full bg-paper-50 text-slate-ink">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {!wsConnected && (
          <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-800">
            Disconnected from backend — reconnecting…
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {mainView === "intercept" ? (
            <InterceptScreen />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col border-r border-paper-200">
                <FlowList />
              </div>
              <FlowDetail />
            </>
          )}
        </div>
      </div>

      <RulesPanel />
      <InterceptEditor />
      <ResendScreen />
      <Diagnostics />
    </div>
  );
}
