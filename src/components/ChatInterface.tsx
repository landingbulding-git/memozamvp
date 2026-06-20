import React, { useState } from 'react';

const ChatInterface = () => {
  const [messages, setMessages] = useState([]);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col p-4">
        <div className="flex items-center mb-6 px-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg mr-2"></div>
            <h1 className="font-semibold text-lg">Memoza</h1>
        </div>
        
        <button className="flex items-center w-full p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium mb-4">
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
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        {messages.length === 0 ? (
          <div className="w-full max-w-2xl text-center space-y-8">
            <h2 className="text-4xl font-medium tracking-tight">Ask and create tasks for your meetings</h2>
            
            {/* Prompt Area */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-2 flex items-center">
              <button className="p-2 text-gray-400">+</button>
              <input
                type="text"
                className="flex-1 p-2 bg-transparent outline-none text-gray-900"
                placeholder="What would you like to know?"
              />
              <button className="p-2 text-gray-400">🎤</button>
              <button className="p-2 bg-indigo-600 text-white rounded-lg">➜</button>
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
        ) : (
            /* Chat Messages (if needed later) */
            <div className="w-full max-w-2xl overflow-y-auto">...</div>
        )}
      </main>
    </div>
  );
};

export default ChatInterface;
