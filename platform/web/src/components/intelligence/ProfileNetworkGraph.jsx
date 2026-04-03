import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export default function ProfileNetworkGraph({ profileId, associates }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!associates || associates.length === 0) return;

    // Prepare data
    const nodes = [
      { id: profileId, name: 'Subject', group: 1, size: 20 },
      ...associates.map(a => ({
        id: a.other_profile_id || a.associate_profile_id,
        name: a.profile?.primary_name || 'Unknown',
        group: 2,
        size: 15,
        relationship: a.relationship_type
      }))
    ];

    const links = associates.map(a => ({
      source: profileId,
      target: a.other_profile_id || a.associate_profile_id,
      strength: a.relationship_strength === 'confirmed' ? 3 : 
                a.relationship_strength === 'strong' ? 2 : 1
    }));

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", "100%")
      .attr("height", 400);

    const width = svgRef.current.clientWidth;
    const height = 400;

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2));

    // Draw links
    const link = svg.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", d => d.strength);

    // Draw nodes
    const node = svg.append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    // Circles
    node.append("circle")
      .attr("r", d => d.size)
      .attr("fill", d => d.group === 1 ? "#ef4444" : "#3b82f6")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    // Labels
    node.append("text")
      .text(d => d.name)
      .attr("x", d => d.size + 5)
      .attr("y", 4)
      .attr("font-size", "12px")
      .attr("fill", "#374151");

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
  }, [associates, profileId]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Associate Network Analysis</h3>
      <svg ref={svgRef} className="w-full h-96"></svg>
      <div className="mt-4 flex gap-4 text-xs text-gray-600 dark:text-gray-400">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500"></span> Subject
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500"></span> Associate
        </span>
      </div>
    </div>
  );
}