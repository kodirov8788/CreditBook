import { NextResponse } from "next/server";

export function unauthorized() {
  return NextResponse.json({ error: "Kirish talab qilinadi." }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError() {
  return NextResponse.json({ error: "Server xatosi." }, { status: 500 });
}
