import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold">Solar View</h1>
        <div className="flex gap-4 flex-wrap">
          <Link href="/solar-scout">
            <Button>Solar Scout</Button>
          </Link>
          <Link href="/lead-inbox">
            <Button variant="outline">Lead Inbox</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
