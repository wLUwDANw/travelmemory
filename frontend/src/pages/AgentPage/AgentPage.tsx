import { useCallback, useRef, useState } from 'react';
import { streamChat } from '../../services/api/agent';
import type {
  ChatMessage,
  EvidenceBlock,
  ParsedPayload,
  ToolResultPayload,
  ToolStartPayload,
} from '../../types/agent';
import { EvidenceList } from './EvidenceList';
import { ToolCallBar } from './ToolCallBar';
import { ToolResultCard } from './ToolResultCard';

/** 阶段 2 的对话页骨架。
 *
 * 只做三件事，但每件都做到能验证：
 *  1. **首字可见** —— 收到第一个 delta 就渲染，不等 done
 *  2. **可中断**   —— 「停止」按钮 abort 掉 fetch，后端随即停止生成
 *  3. **证据可见** —— 展示 [n] 与文档引用，点开能看到原文（阶段 6 再接地图高亮）
 */
export function AgentPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const patchLast = useCallback((patch: Partial<ChatMessage>) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], ...patch };
      return next;
    });
  }, []);

  const send = useCallback(async () => {
    const query = input.trim();
    if (!query || streaming) return;

    setInput('');
    setError(null);
    setStreaming(true);

    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: query },
      { id: assistantId, role: 'assistant', content: '' },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of streamChat({ query }, controller.signal)) {
        switch (event.type) {
          case 'parsed':
            patchLast({ parsed: event.payload as unknown as ParsedPayload });
            break;
          case 'tool_start':
            patchLast({ toolStart: event.payload as ToolStartPayload });
            break;
          case 'tool_result':
            patchLast({ toolResult: event.payload as ToolResultPayload });
            break;
          case 'evidence':
            patchLast({ evidence: (event.payload as { blocks: EvidenceBlock[] }).blocks });
            break;
          case 'delta':
            // 逐段追加 —— 这就是"首字可见"的全部秘密
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + (event.payload as string) };
              return next;
            });
            break;
          case 'restart':
            // self_check 未通过：后端要重生成，前端必须把已渲染的内容丢掉
            patchLast({ content: '' });
            break;
          case 'done':
            patchLast({ done: event.payload as ChatMessage['done'] });
            break;
          case 'error':
            setError((event.payload as { message: string }).message);
            break;
          default:
            break;
        }
      }
    } catch (exc) {
      const err = exc as Error;
      // AbortError 是用户主动点「停止」，不是错误 —— 保留已生成的部分，不报错
      if (err.name !== 'AbortError') setError(err.message ?? String(exc));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, patchLast]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return (
    <div className="agent-page">
      <header className="agent-header">
        <h1>旅忆地图 · 记忆问答</h1>
        <p className="hint">问一句关于你旅行记忆的话，每条事实性回答都会带上照片证据。</p>
      </header>

      <div className="message-list">
        {messages.length === 0 && (
          <p className="empty">
            试试问：「我去年秋天去过哪些古镇？」「前年五一我在哪？」「我在杭州最喜欢哪类地点？」
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`message message-${message.role}`}>
            <div className="bubble">
              {message.content}
              {streaming && message.id.startsWith('a-') && message.role === 'assistant' && (
                <span className="caret" />
              )}
            </div>
            {message.role === 'assistant' && (
              <ToolCallBar start={message.toolStart} result={message.toolResult} />
            )}
            {message.role === 'assistant' && message.parsed && (
              <FilterChips parsed={message.parsed} />
            )}
            {message.role === 'assistant' && message.toolResult && (
              <ToolResultCard result={message.toolResult} />
            )}
            {message.role === 'assistant' && message.done && (
              <div className="meta-row">
                <span>{message.done.latency_ms}ms</span>
                {message.done.refused && (
                  <span className="refused">已拒答：{message.done.refuse_reason}</span>
                )}
                {message.done.citations.length > 0 && (
                  <span>引用 {message.done.citations.length} 条</span>
                )}
              </div>
            )}
            {message.role === 'assistant' && message.evidence && (
              <EvidenceList blocks={message.evidence} />
            )}
          </div>
        ))}
      </div>

      {error && <div className="error-bar">出错了：{error}</div>}

      <div className="composer">
        <input
          value={input}
          onChange={(evt) => setInput(evt.target.value)}
          onKeyDown={(evt) => {
            if (evt.key === 'Enter' && !evt.nativeEvent.isComposing) void send();
          }}
          placeholder="问我关于你旅行记忆的问题…"
          disabled={streaming}
        />
        {streaming ? (
          <button className="stop" onClick={stop}>
            停止
          </button>
        ) : (
          <button onClick={() => void send()} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  );
}

function FilterChips({ parsed }: { parsed: ParsedPayload }) {
  const chips: string[] = [];
  if (parsed.time_range) {
    chips.push(`时间 ${parsed.time_range.start} ~ ${parsed.time_range.end}（${parsed.time_source}）`);
  }
  for (const place of parsed.places ?? []) chips.push(`地点 ${place}`);
  for (const theme of parsed.themes ?? []) chips.push(`主题 ${theme}`);
  if (!chips.length) return null;
  return (
    <div className="filter-chips">
      <span className="chip-label">我理解了：</span>
      {chips.map((chip) => (
        <span key={chip} className="chip">
          {chip}
        </span>
      ))}
    </div>
  );
}
