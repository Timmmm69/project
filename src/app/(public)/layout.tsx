import type { ReactNode } from "react";
import { SiteFooter } from "@/components/public/site-footer";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <>{children}<SiteFooter /></>;
}
