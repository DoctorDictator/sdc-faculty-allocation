import type { Metadata } from "next";
import FacultyDirectory from "@/components/faculty-directory";
import directory from "@/data/manipal-cse-faculty.json";

export const metadata: Metadata = {
  title: "CSE Faculty Directory | FacultyFlow",
  description: "Public faculty directory for Manipal University Jaipur Department of Computer Science and Engineering.",
};

export default function DirectoryPage() {
  return <FacultyDirectory faculty={directory.faculty} retrievedAt={directory.retrievedAt} />;
}
