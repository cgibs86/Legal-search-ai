"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" /> Print / Save as PDF
    </Button>
  );
}
