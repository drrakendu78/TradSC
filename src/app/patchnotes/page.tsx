"use client";
import { useEffect, useState } from "react";

type Release = {
  name: string;
  body: string;
  published_at: string;
  tag_name: string;
};

export default function PatchnotesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("https://api.github.com/repos/drrakendu78/TradSC/releases")
      .then((res) => res.json())
      .then((data) => {
        setReleases(data);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Chargement des patchnotes...</div>;

  return (
    <div className="space-y-4 p-4 max-h-screen overflow-auto">
      <h1 className="text-2xl font-bold text-primary">Patchnotes</h1>
      <div className="flex flex-col gap-6">
        {releases.map((release) => (
          <div key={release.tag_name} className="bg-card p-4 rounded-lg shadow">
            <h2 className="font-semibold text-lg">{release.name}</h2>
            <p className="text-xs text-muted-foreground">{new Date(release.published_at).toLocaleString()}</p>
            <div className="mt-2 whitespace-pre-line">{release.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
