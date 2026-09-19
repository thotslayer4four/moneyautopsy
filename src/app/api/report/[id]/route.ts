import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { shapeForStatus } from "@/lib/report";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }
  return NextResponse.json({ report: shapeForStatus(session.report, session.status) });
}
