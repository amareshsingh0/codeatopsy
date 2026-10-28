"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { EXAMPLES } from "@/lib/examples";
import { Icon } from "./Icon";
export function VisualAtlas() {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const items = EXAMPLES.filter(
    (example) =>
      (filter === "All" || example.category === filter) &&
      `${example.title} ${example.question}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="learning-path panel" aria-label="Suggested learning path">
        <div>
          <span className="eyebrow">A SIMPLE PLACE TO START</span>
          <h2>One idea. One visible change.</h2>
          <p>Choose a small program, run it, then follow the highlighted code.</p>
        </div>
        <ol>
          {[
            ["arrays", "Changing values"],
            ["branches", "Making decisions"],
            ["graphs", "Following connections"],
            ["dynamic-programming", "Building an answer"],
          ].map(([slug, label], i) => (
            <li key={slug}>
              <Link href={`/playground?example=${slug}`}>
                <span>{i + 1}</span>
                {label}
                <Icon name="arrow" size={14} />
              </Link>
            </li>
          ))}
        </ol>
      </section>
      <div className="atlas-filters">
        <div className="atlas-tabs" aria-label="Filter topics">
          {["All", "Data", "Structures", "Algorithms", "Execution"].map((category) => (
            <button
              key={category}
              className={`btn ${filter === category ? "btn-primary" : ""}`}
              aria-pressed={filter === category}
              onClick={() => setFilter(category)}
            >
              {category}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Search learning topics"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a concept…"
        />
      </div>
      <div className="atlas-results">
        <span role="status">
          {items.length} of {EXAMPLES.length} concepts
        </span>
        <span>Real programs · editable code · recorded replay</span>
      </div>
      <div className="atlas-grid">
        {items.map((example) => (
          <article className="panel atlas-card" key={example.slug}>
            <div className="atlas-image">
              <Image
                src={`/visuals/${example.slug}.webp`}
                alt={`Concept illustration: ${example.title}`}
                fill
                sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw"
              />
            </div>
            <div className="atlas-copy">
              <span className="eyebrow">{example.category}</span>
              <h2>{example.title}</h2>
              <p>{example.question}</p>
              <span className="atlas-meta">Python · change the code and compare</span>
              <Link className="btn" href={`/playground?example=${example.slug}`}>
                Run & explore
                <Icon name="arrow" />
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="empty-state">
          <p>No concepts match your search.</p>
          <button
            className="btn"
            onClick={() => {
              setQuery("");
              setFilter("All");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
