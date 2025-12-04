import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Minus } from "lucide-react";
import UserMenuButton from './user-menu-button';

export default function ControlMenu() {
    const appWindow = getCurrentWindow();

    const minimize = async () => await appWindow?.minimize();
    const close = async () => await appWindow?.close();

    return (
        <div className='flex flex-row gap-2 absolute right-4 top-4 z-10 items-center'>
            <UserMenuButton />
            <button onClick={minimize} 
                className='bg-gray-500 hover:bg-yellow-400 rounded-full flex justify-center items-center p-0.5 group shrink-0'>
                <Minus strokeWidth={2} className='h-2.5 w-2.5 text-gray-100 group-hover:text-background' />
            </button>
            <button onClick={close} 
                className='bg-gray-500 hover:bg-red-400 rounded-full flex justify-center items-center p-0.5 group shrink-0'>
                <X strokeWidth={2} className='h-2.5 w-2.5 text-gray-100 group-hover:text-background'/>
            </button>
        </div>
    )
}