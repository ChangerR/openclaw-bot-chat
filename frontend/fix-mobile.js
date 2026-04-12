const fs = require('fs');

// 1. Update AppLayout.tsx
let appLayout = fs.readFileSync('src/components/AppLayout.tsx', 'utf8');
appLayout = appLayout.replace(
  /<aside className="w-\[72px\] h-screen bg-white\/40 backdrop-blur-2xl flex flex-col items-center py-6 gap-8 border-r border-white\/20">/,
  `<aside className="w-full h-[60px] md:w-[72px] md:h-screen bg-white/80 md:bg-white/40 backdrop-blur-2xl flex flex-row md:flex-col items-center justify-around md:justify-start py-0 md:py-6 px-4 md:px-0 gap-0 md:gap-8 border-t md:border-t-0 md:border-r border-white/20 z-50 flex-shrink-0">`
);
appLayout = appLayout.replace(
  /<div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-sky-200">/,
  `<div className="hidden md:flex w-10 h-10 bg-sky-500 rounded-xl items-center justify-center text-white shadow-lg shadow-sky-200">`
);
appLayout = appLayout.replace(
  /<nav className="flex-1 flex flex-col gap-4">/,
  `<nav className="flex-1 flex flex-row md:flex-col gap-6 md:gap-4 items-center justify-center md:justify-start">`
);
appLayout = appLayout.replace(
  /<div className="flex flex-col gap-4 items-center">/,
  `<div className="flex flex-row md:flex-col gap-4 items-center">\n        <div className="hidden md:block">`
);
appLayout = appLayout.replace(
  /<button\n\s*onClick=\{logout\}/,
  `</div>\n        <button\n          onClick={logout}`
);
appLayout = appLayout.replace(
  /<div className="flex h-screen w-full overflow-hidden bg-gradient-to-br from-\[#F0F4F8\] to-\[#E2E8F0\]">/,
  `<div className="flex flex-col-reverse md:flex-row h-[100dvh] w-full overflow-hidden bg-gradient-to-br from-[#F0F4F8] to-[#E2E8F0]">`
);
appLayout = appLayout.replace(
  /<main className="flex flex-1 overflow-hidden">/,
  `<main className="flex flex-1 overflow-hidden relative">`
);
fs.writeFileSync('src/components/AppLayout.tsx', appLayout);

// 2. Update ChatInput.tsx
let chatInput = fs.readFileSync('src/components/Chat/ChatInput.tsx', 'utf8');
chatInput = chatInput.replace(
  /<div className="px-6 py-4 bg-white\/50 border-t border-slate-200\/50 backdrop-blur-sm relative">/,
  `<div className="px-3 md:px-6 py-3 md:py-4 bg-white/50 border-t border-slate-200/50 backdrop-blur-sm relative">`
);
chatInput = chatInput.replace(
  /className="absolute bottom-full left-6 mb-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50 animate-in slide-in-from-bottom-2"/,
  `className="absolute bottom-full left-3 md:left-6 mb-2 w-[calc(100%-24px)] md:w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50 animate-in slide-in-from-bottom-2"`
);
fs.writeFileSync('src/components/Chat/ChatInput.tsx', chatInput);

// 3. Update MessageBubble.tsx
let msgBubble = fs.readFileSync('src/components/Chat/MessageBubble.tsx', 'utf8');
msgBubble = msgBubble.replace(
  /className=\{`flex max-w-\[80%\] \$\{isOwn \? 'flex-row-reverse' : 'flex-row'\} items-end gap-3`\}/,
  'className={`flex max-w-[90%] md:max-w-[80%] ${isOwn ? \'flex-row-reverse\' : \'flex-row\'} items-end gap-2 md:gap-3`}'
);
fs.writeFileSync('src/components/Chat/MessageBubble.tsx', msgBubble);

// 4. Update Bots page
let botsPage = fs.readFileSync('src/app/bots/page.tsx', 'utf8');
botsPage = botsPage.replace(
  /const \[runtimeActivity, setRuntimeActivity\] = useState<Record<string, string \| null>>\(\{\}\)/,
  `const [runtimeActivity, setRuntimeActivity] = useState<Record<string, string | null>>({})\n  const [showMobileList, setShowMobileList] = useState(true)`
);
botsPage = botsPage.replace(
  /const handleBotClick = \(bot: Bot\) => \{\n\s*openBotConversation\(bot\)\n\s*setSelectedBot\(bot\)\n\s*setView\('chat'\)\n\s*\}/,
  `const handleBotClick = (bot: Bot) => {\n    openBotConversation(bot)\n    setSelectedBot(bot)\n    setView('chat')\n    setShowMobileList(false)\n  }`
);
botsPage = botsPage.replace(
  /<aside className="w-\[300px\] h-screen bg-white\/65 backdrop-blur-xl border-r border-white\/20 flex flex-col overflow-hidden">/,
  `<aside className={\`w-full md:w-[300px] h-full bg-white/65 backdrop-blur-xl border-r border-white/20 flex flex-col overflow-hidden flex-shrink-0 \${showMobileList ? 'flex' : 'hidden md:flex'}\`}>`
);
botsPage = botsPage.replace(
  /onClick=\{\(\) => setView\('create'\)\}/g,
  `onClick={() => { setView('create'); setShowMobileList(false); }}`
);
botsPage = botsPage.replace(
  /<section className="flex-1 h-screen flex flex-col bg-white\/95 relative overflow-hidden">/,
  `<section className={\`flex-1 h-full flex flex-col bg-white/95 relative overflow-hidden \${!showMobileList ? 'flex' : 'hidden md:flex'}\`}>`
);
botsPage = botsPage.replace(
  /<header className="h-\[72px\] px-6 flex items-center justify-between border-b border-slate-100 bg-white\/80 backdrop-blur-md z-10">/,
  `<header className="h-[60px] md:h-[72px] px-4 md:px-6 flex items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur-md z-10">`
);
botsPage = botsPage.replace(
  /<div className="flex items-center gap-3">\n\s*<Avatar/,
  `<div className="flex items-center gap-2 md:gap-3">\n                <button\n                  onClick={() => setShowMobileList(true)}\n                  className="md:hidden p-1.5 -ml-1.5 text-slate-400 hover:text-sky-500 rounded-lg"\n                >\n                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>\n                </button>\n                <Avatar`
);
botsPage = botsPage.replace(
  /<header className="mb-8">\n\s*<h2 className="text-3xl font-bold text-slate-800 tracking-tight">/,
  `<header className="mb-6 md:mb-8 flex items-start gap-3">\n              <button onClick={() => { setView('chat'); setShowMobileList(true); }} className="md:hidden mt-1 p-1 -ml-2 text-slate-400 hover:text-sky-500">\n                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>\n              </button>\n              <div>\n                <h2 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">`
);
botsPage = botsPage.replace(
  /<\/header>\n\s*<CreateEditBotForm/g,
  `</div>\n            </header>\n            \n            <CreateEditBotForm`
);
botsPage = botsPage.replace(
  /onCancel=\{\(\) => setView\('chat'\)\}/g,
  `onCancel={() => { setView('chat'); setShowMobileList(true); }}`
);
botsPage = botsPage.replace(
  /onSuccess=\{\(bot\) => \{\n\s*void refreshBots\(\)\n\s*setSelectedBot\(bot\)\n\s*setView\('chat'\)\n\s*\}\}/g,
  `onSuccess={(bot) => {\n                void refreshBots()\n                setSelectedBot(bot)\n                setView('chat')\n                setShowMobileList(false)\n              }}`
);
fs.writeFileSync('src/app/bots/page.tsx', botsPage);

// 5. Update Groups page
let groupsPage = fs.readFileSync('src/app/groups/page.tsx', 'utf8');
groupsPage = groupsPage.replace(
  /const \[showDrawer, setShowDrawer\] = useState\(false\)/,
  `const [showDrawer, setShowDrawer] = useState(false)\n  const [showMobileList, setShowMobileList] = useState(true)`
);
groupsPage = groupsPage.replace(
  /const handleGroupClick = \(group: Group\) => \{\n\s*openGroupConversation\(group\)\n\s*setSelectedGroup\(group\)\n\s*setView\('chat'\)\n\s*setShowDrawer\(false\)\n\s*\}/,
  `const handleGroupClick = (group: Group) => {\n    openGroupConversation(group)\n    setSelectedGroup(group)\n    setView('chat')\n    setShowDrawer(false)\n    setShowMobileList(false)\n  }`
);
groupsPage = groupsPage.replace(
  /<aside className="w-\[300px\] h-screen bg-white\/65 backdrop-blur-xl border-r border-white\/20 flex flex-col overflow-hidden">/,
  `<aside className={\`w-full md:w-[300px] h-full bg-white/65 backdrop-blur-xl border-r border-white/20 flex flex-col overflow-hidden flex-shrink-0 \${showMobileList ? 'flex' : 'hidden md:flex'}\`}>`
);
groupsPage = groupsPage.replace(
  /onClick=\{\(\) => setView\('create'\)\}/g,
  `onClick={() => { setView('create'); setShowMobileList(false); }}`
);
groupsPage = groupsPage.replace(
  /<section className="flex-1 h-screen flex flex-col bg-white\/95 relative overflow-hidden">/,
  `<section className={\`flex-1 h-full flex flex-col bg-white/95 relative overflow-hidden \${!showMobileList ? 'flex' : 'hidden md:flex'}\`}>`
);
groupsPage = groupsPage.replace(
  /<header className="h-\[72px\] px-6 flex items-center justify-between border-b border-slate-100 bg-white\/80 backdrop-blur-md z-10">/,
  `<header className="h-[60px] md:h-[72px] px-4 md:px-6 flex items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur-md z-10">`
);
groupsPage = groupsPage.replace(
  /<div className="flex items-center gap-3">\n\s*<Avatar/,
  `<div className="flex items-center gap-2 md:gap-3">\n                <button\n                  onClick={() => setShowMobileList(true)}\n                  className="md:hidden p-1.5 -ml-1.5 text-slate-400 hover:text-sky-500 rounded-lg"\n                >\n                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>\n                </button>\n                <Avatar`
);
groupsPage = groupsPage.replace(
  /<header className="mb-8">\n\s*<h2 className="text-3xl font-bold text-slate-800 tracking-tight">/,
  `<header className="mb-6 md:mb-8 flex items-start gap-3">\n              <button onClick={() => { setView('chat'); setShowMobileList(true); }} className="md:hidden mt-1 p-1 -ml-2 text-slate-400 hover:text-sky-500">\n                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>\n              </button>\n              <div>\n                <h2 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight">`
);
groupsPage = groupsPage.replace(
  /<\/header>\n\s*<CreateGroupForm/g,
  `</div>\n            </header>\n            \n            <CreateGroupForm`
);
groupsPage = groupsPage.replace(
  /onCancel=\{\(\) => setView\('chat'\)\}/g,
  `onCancel={() => { setView('chat'); setShowMobileList(true); }}`
);
groupsPage = groupsPage.replace(
  /onSuccess=\{\(\) => \{\n\s*void refreshGroups\(\)\n\s*setView\('chat'\)\n\s*\}\}/g,
  `onSuccess={() => {\n                void refreshGroups()\n                setView('chat')\n                setShowMobileList(false)\n              }}`
);
groupsPage = groupsPage.replace(
  /className=\{`absolute right-0 top-0 h-full w-\[320px\] bg-white shadow-2xl border-l border-slate-100 transition-transform duration-300 z-20 \$\{showDrawer \? 'translate-x-0' : 'translate-x-full'\}`\}/,
  `className={\`absolute right-0 top-0 h-full w-full md:w-[320px] bg-white shadow-2xl md:border-l border-slate-100 transition-transform duration-300 z-20 \${showDrawer ? 'translate-x-0' : 'translate-x-full'}\`}`
);
fs.writeFileSync('src/app/groups/page.tsx', groupsPage);

console.log('Mobile adaptations applied.');
