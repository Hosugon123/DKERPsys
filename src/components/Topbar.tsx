import { Bell, Settings, Menu, Search, ChevronDown } from 'lucide-react';
import { UserRole } from '../views/Orders';

interface TopbarProps {
  setIsMobileMenuOpen: (isOpen: boolean) => void;
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
}

export default function Topbar({ setIsMobileMenuOpen, userRole, setUserRole }: TopbarProps) {
  const roleDisplayNames = {
    admin: '超級管理員',
    franchisee: '加盟主',
    employee: '直營店員工'
  };
  return (
    <header className="bg-[#111111] border-b border-zinc-800 h-16 flex items-center justify-between px-4 lg:px-8 z-30 sticky top-0">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 -ml-2 rounded-lg text-zinc-400 hover:bg-zinc-800 lg:hidden"
        >
          <Menu size={24} />
        </button>
        <div className="text-lg font-black text-[#f5f2ed] hidden sm:block tracking-tighter">
          東山鴨頭職人管理系統
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input 
            type="text" 
            placeholder="搜尋系統..." 
            className="pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-full text-sm focus:border-amber-500 w-64 transition-all outline-none text-zinc-300 placeholder-zinc-500"
          />
        </div>
        
        <button className="p-2 rounded-full text-zinc-400 hover:bg-zinc-800 transition-colors">
          <Bell size={20} />
        </button>
        <button className="p-2 rounded-full text-zinc-400 hover:bg-zinc-800 transition-colors">
          <Settings size={20} />
        </button>
        
        <div className="flex flex-col items-end hidden sm:flex ml-2">
          <span className="text-xs text-zinc-500">測試帳號切換</span>
          <div className="relative group">
            <select 
              value={userRole}
              onChange={(e) => setUserRole(e.target.value as UserRole)}
              className="appearance-none bg-transparent text-sm font-medium text-amber-500 underline underline-offset-4 cursor-pointer focus:outline-none pr-4"
            >
              <option value="admin" className="bg-zinc-800 text-[#f5f2ed]">超級管理員 (總部)</option>
              <option value="franchisee" className="bg-zinc-800 text-[#f5f2ed]">加盟主 (分店)</option>
              <option value="employee" className="bg-zinc-800 text-[#f5f2ed]">直營店員工</option>
            </select>
            <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-amber-500 pointer-events-none" />
          </div>
        </div>
        
        <div className="w-10 h-10 rounded-full border border-zinc-700 bg-zinc-800 ml-2 overflow-hidden flex flex-shrink-0">
          <img 
            src="https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=27272a" 
            alt="使用者頭像" 
            className="w-full h-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
