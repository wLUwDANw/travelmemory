import { AgentPage } from './pages/AgentPage';

/** 阶段 2 的应用壳。
 *
 * 刻意只有一页：设计文档 §6.1 说地图是主界面，但地图要等阶段 6（W6-2）。
 * 现阶段先让「对话 + 证据」这条主线成立，阶段 6 再把 Agent 收进地图旁的抽屉里 ——
 * 那时的改动是布局，不是逻辑。
 */
export default function App() {
  return <AgentPage />;
}
