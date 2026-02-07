"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { useProjects } from "./ProjectsProvider";

type GenerationJob = {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  request: {
    folderId?: string;
    model: string;
    type: string;
    prompt: string;
  };
};

export function GenerateJobsView() {
  const { selectedProjectId, selectedProject } = useProjects();
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadJobs() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<{ jobs: GenerationJob[] }>("/v1/generation/jobs/ws_demo");
      setJobs(result.jobs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs();
    const timer = setInterval(() => void loadJobs(), 5000);
    return () => clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    if (!selectedProjectId) return jobs;
    return jobs.filter((job) => job.request.folderId === selectedProjectId);
  }, [jobs, selectedProjectId]);

  return (
    <main className="page">
      <header className="page-head">
        <h2>Generation Jobs</h2>
        <p>{selectedProject ? `Jobs targeting ${selectedProject.name}` : "Select a project to filter jobs."}</p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="panel">
        <button className="btn" onClick={() => void loadJobs()} disabled={loading}>Refresh</button>

        <div className="list-table">
          {loading ? <p className="muted">Loading jobs...</p> : null}
          {!loading && filtered.length === 0 ? <p className="muted">No jobs for selected project.</p> : null}

          {!loading && filtered.map((job) => (
            <div className="list-row" key={job.id}>
              <div>
                <strong>{job.request.type} · {job.request.model}</strong>
                <p className="muted mono">{job.request.prompt.slice(0, 80)}</p>
              </div>
              <div className="job-meta">
                <span className={`status ${job.status.toLowerCase()}`}>{job.status}</span>
                <span className="muted mono">{new Date(job.createdAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
