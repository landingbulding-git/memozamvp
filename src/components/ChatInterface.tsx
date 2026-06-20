import React, { useState, useRef, useEffect } from 'react';

const ChatInterface = () => {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (!response.ok) throw new Error(await response.text());

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                assistantContent += data.text;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1].content = assistantContent;
                  return newMessages;
                });
              }
            } catch (e) {
              console.error("Error parsing stream chunk", e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error processing your request.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col p-4">
        <div className="flex items-center mb-6 px-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg mr-2"></div>
            <h1 className="font-semibold text-lg">Memoza</h1>
        </div>
        
        <button 
          onClick={() => setMessages([])}
          className="flex items-center w-full p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium mb-4"
        >
          <span className="mr-2">+</span> New chat
        </button>

        <div className="flex-1 overflow-y-auto space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase px-2">Chat History</p>
          <div className="text-sm text-gray-600 hover:bg-gray-100 p-2 rounded cursor-pointer">Project kickoff</div>
        </div>
        
        <div className="border-t pt-4 space-y-2 text-sm text-gray-600">
          <div className="hover:bg-gray-100 p-2 rounded cursor-pointer">Settings</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
            <div className="w-full max-w-2xl text-center space-y-8">
              <h2 className="text-4xl font-medium tracking-tight">Ask and create tasks for your meetings</h2>
              
              {/* Prompt Area */}
              <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-2 flex items-center">
                <button className="p-2 text-gray-400">+</button>
                <input
                  type="text"
                  className="flex-1 p-2 bg-transparent outline-none text-gray-900"
                  placeholder="What would you like to know?"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                />
                <button className="p-2 text-gray-400">🎤</button>
                <button 
                  className={`p-2 rounded-lg text-white ${isLoading || !input.trim() ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  onClick={() => handleSubmit()}
                  disabled={isLoading || !input.trim()}
                >
                  ➜
                </button>
              </div>

              {/* Quick Actions */}
              <div className="flex justify-center gap-2">
                <button className="text-sm px-4 py-2 border rounded-full hover:bg-gray-100">Spot Issues</button>
                <button className="text-sm px-4 py-2 border rounded-full hover:bg-gray-100">Analyze Performance</button>
              </div>
              
              {/* Templates */}
              <div className="text-left mt-12">
                <p className="mb-4 font-semibold">Start with a template</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 border rounded-xl hover:shadow-md cursor-pointer">
                      <p className="font-medium text-sm">Meeting Audit</p>
                      <p className="text-xs text-gray-500">Analyze meeting effectiveness.</p>
                  </div>
                  <div className="p-4 border rounded-xl hover:shadow-md cursor-pointer">
                      <p className="font-medium text-sm">Action Items</p>
                      <p className="text-xs text-gray-500">Extract tasks from meeting.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center p-8 overflow-y-auto pb-32">
            <div className="w-full max-w-3xl space-y-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl p-4 ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-900'}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            
            {/* Sticky Input Area for ongoing chat */}
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent flex justify-center">
              <div className="w-full max-w-3xl bg-white border border-gray-200 shadow-sm rounded-2xl p-2 flex items-center">
                <button className="p-2 text-gray-400">+</button>
                <input
                  type="text"
                  className="flex-1 p-2 bg-transparent outline-none text-gray-900"
                  placeholder="Ask a follow-up..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                />
                <button className="p-2 text-gray-400">🎤</button>
                <button 
                  className={`p-2 rounded-lg text-white ${isLoading || !input.trim() ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  onClick={() => handleSubmit()}
                  disabled={isLoading || !input.trim()}
                >
                  ➜
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ChatInterface;
