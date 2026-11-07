import type { UserRole } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      facultyId: string | null;
    } & NonNullable<DefaultSession["user"]>;
  }

  interface User {
    role: UserRole;
    facultyId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    facultyId?: string | null;
  }
}

import type { DefaultSession } from "next-auth";
