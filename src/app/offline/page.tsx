export const metadata = { title: "Offline" };
export default function Offline() {
  return (
    <main className="mx-auto max-w-md p-6">
      <div className="card p-6">
        <h1 className="text-xl font-bold">You are offline</h1>
        <p className="mt-2">
          Pages you opened recently, the item list and the scanner still work from the cached copy. Actions that change data need a connection; check-outs and check-ins you make
          offline are queued and are not confirmed until they sync.
        </p>
        <a href="/scan" className="btn btn-primary mt-4 w-full">
          Open scanner
        </a>
      </div>
    </main>
  );
}
