import { auth } from "../auth";
import { NextResponse } from "next/server";

export default auth((request) => {
  const path = request.nextUrl.pathname;
  const isLoginPage = path === "/login";
  const isPublicDirectory = path === "/directory";
  const isAuthenticated = Boolean(request.auth?.user);
  if (!isAuthenticated && !isLoginPage && !isPublicDirectory && !path.startsWith("/api/auth/")) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }
  if (isAuthenticated && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
