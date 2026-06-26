import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const mdComponents: Record<string, React.ComponentType<any>> = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
  hr: () => <hr className="my-3 border-gray-200" />,
  code: ({ children }) => (
    <code className="bg-gray-100 text-gray-700 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
  ),
  a: ({ href, children }) => {
    const isNotion = href?.includes('notion.so');
    if (isNotion) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 hover:border-gray-300 transition-colors no-underline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15,3 21,3 21,9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          {children}
        </a>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
};

const TypingIndicator = () => (
  <div className="flex items-center gap-1 py-1 px-1">
    {[0, 150, 300].map((delay) => (
      <span
        key={delay}
        className="w-2 h-2 bg-gray-300 rounded-full"
        style={{ animation: `bounce 1.2s ease-in-out infinite`, animationDelay: `${delay}ms` }}
      />
    ))}
    <style>{`@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }`}</style>
  </div>
);

const InputBar = ({
  value,
  onChange,
  onKeyDown,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
}) => (
  <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-2 flex items-center gap-1">
    <input
      type="text"
      className="flex-1 px-2 py-1.5 bg-transparent outline-none text-gray-900 text-sm placeholder:text-gray-400"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      disabled={disabled}
    />
    <button
      className={`px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-colors ${
        disabled || !value.trim() ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
      }`}
      onClick={onSubmit}
      disabled={disabled || !value.trim()}
    >
      Send
    </button>
  </div>
);

const ChatInterface = () => {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const email = document.cookie
      .split('; ')
      .find(row => row.startsWith('user_email='))
      ?.split('=')[1];
    setUserEmail(email || null);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat-supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (response.status === 401) {
        throw new Error('Please verify your database connection.');
      }

      if (!response.ok) throw new Error(await response.text());

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                assistantContent += data.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
                  return updated;
                });
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: error.message || 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (err) {
      console.error('Failed to sign out', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col p-4 shrink-0">
        <div className="flex items-center mb-6 px-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg mr-2.5" />
          <h1 className="font-semibold text-base">Memoza</h1>
        </div>

        <button
          onClick={() => setMessages([])}
          className="flex items-center w-full px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium mb-4 transition-colors"
        >
          <span className="mr-2 text-gray-500">+</span> New chat
        </button>

        <div className="flex-1 overflow-y-auto">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide px-2 mb-2">History</p>
          <div className="text-sm text-gray-600 hover:bg-gray-100 px-2 py-1.5 rounded cursor-pointer">
            Project kickoff
          </div>
        </div>

        <div className="border-t pt-4 text-sm">
          <div className="space-y-2">
            <div className="px-2 py-1.5 flex items-center justify-between text-gray-600">
              <span className="truncate text-xs">{userEmail}</span>
              <span className="w-2 h-2 bg-green-500 rounded-full ml-2 shrink-0" />
            </div>
            <button
              onClick={handleSignOut}
              className="w-full text-left text-red-600 font-medium hover:text-red-700 px-2 py-1.5 transition-colors text-xs"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="w-full max-w-2xl text-center space-y-8">
              <h2 className="text-3xl font-medium tracking-tight">Manage your meetings</h2>

              <InputBar
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onSubmit={handleSubmit}
                disabled={isLoading}
                placeholder="What would you like to know?"
              />

              <div className="text-left pt-4">
                <p className="text-sm font-medium text-gray-500 mb-3">Try asking</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { title: 'List Meetings', desc: 'Show all meetings' },
                    { title: 'Create Meeting', desc: 'Add a new meeting' },
                    { title: 'Action Items', desc: 'Show open tasks' },
                    { title: 'Sample Data', desc: 'Create sample meeting' },
                  ].map((t) => (
                    <button
                      key={t.title}
                      onClick={() => setInput(t.desc)}
                      className="text-left p-4 border border-gray-200 rounded-xl hover:bg-white hover:shadow-sm transition cursor-pointer"
                    >
                      <p className="font-medium text-sm text-gray-900">{t.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Chat view */
          <div className="flex-1 flex flex-col items-center overflow-y-auto px-6 pt-8 pb-36">
            <div className="w-full max-w-2xl space-y-5">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 bg-indigo-600 rounded-md mr-3 mt-0.5 shrink-0" />
                  )}
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-gray-900 rounded-bl-sm'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      msg.content
                    ) : msg.content === '' ? (
                      <TypingIndicator />
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Sticky input — only shown during active chat */}
        {messages.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 flex justify-center px-6 pb-6 bg-gradient-to-t from-gray-50 via-gray-50/90 to-transparent pt-8">
            <div className="w-full max-w-2xl">
              <InputBar
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onSubmit={handleSubmit}
                disabled={isLoading}
                placeholder="Ask a follow-up..."
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ChatInterface;
