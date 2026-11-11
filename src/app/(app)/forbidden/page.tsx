import Link from "next/link";
export const metadata = { title: "Not allowed" };
export default function Forbidden() {
  return (
    <div className="card p-6">
      <h1 className="text-xl font-bold">Your role cannot open this page.</h1>
      <p className="mt-2">Permissions follow section 9 of the requirements. Ask the Owner if you need access.</p>
      <Link href="/" className="btn btn-primary mt-4">
        Home
      </Link>
    </div>
  );
}
