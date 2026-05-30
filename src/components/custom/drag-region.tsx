import React, { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface DragRegionProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export function DragRegion({ children, className = '', style, ...props }: DragRegionProps) {
  const appWindow = getCurrentWindow();
  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const isMouseDownRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Détecte un clic sur la scrollbar native : la gouttière est au-delà de la
    // zone client (à droite pour la verticale, en bas pour l'horizontale). On
    // exclut ces clics du drag — sinon grab du thumb = la fenêtre se déplace au
    // lieu de scroller (le mousemove perd l'élément scrollable pendant le drag).
    const isOnScrollbar = (el: HTMLElement, ev: MouseEvent): boolean => {
      const rect = el.getBoundingClientRect();
      const sbW = el.offsetWidth - el.clientWidth;  // largeur scrollbar verticale
      const sbH = el.offsetHeight - el.clientHeight; // hauteur scrollbar horizontale
      if (sbW > 0 && ev.clientX >= rect.right - sbW) return true;
      if (sbH > 0 && ev.clientY >= rect.bottom - sbH) return true;
      return false;
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Clic sur la scrollbar → laisser le navigateur gérer le scroll, jamais de drag.
      if (isOnScrollbar(target, e)) return;

      const isInteractive = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
                          target.closest('button, a, input, select, textarea, [role="button"], [role="slider"], [data-no-drag]');

      // Check if target or parent is scrollable
      const isInScrollable = (element: HTMLElement | null): boolean => {
        while (element) {
          const style = window.getComputedStyle(element);
          const overflowY = style.overflowY;
          if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
            return true;
          }
          element = element.parentElement;
        }
        return false;
      };

      if (!isInteractive && !isInScrollable(target)) {
        appWindow.startDragging();
      } else {
        startPosRef.current = { x: e.clientX, y: e.clientY };
        isMouseDownRef.current = true;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isMouseDownRef.current && startPosRef.current) {
        const target = e.target as HTMLElement;

        // Check if target or parent is scrollable
        const isInScrollable = (element: HTMLElement | null): boolean => {
          while (element) {
            const style = window.getComputedStyle(element);
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
              return true;
            }
            element = element.parentElement;
          }
          return false;
        };

        if (isInScrollable(target)) {
          isMouseDownRef.current = false;
          startPosRef.current = null;
          return;
        }

        const deltaX = Math.abs(e.clientX - startPosRef.current.x);
        const deltaY = Math.abs(e.clientY - startPosRef.current.y);

        if (deltaX > 5 || deltaY > 5) {
          appWindow.startDragging();
          isMouseDownRef.current = false;
          startPosRef.current = null;
        }
      }
    };

    const handleMouseUp = () => {
      isMouseDownRef.current = false;
      startPosRef.current = null;
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <main ref={containerRef} className={className} style={style} {...props}>
      {children}
    </main>
  );
}
