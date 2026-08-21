'use client';

import { usePathname } from 'next/navigation';

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isNewsreel = pathname?.startsWith('/newsreel');

  return <main className={isNewsreel ? undefined : 'pt-16'}>{children}</main>;
}
