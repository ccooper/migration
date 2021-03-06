export default class WorkGraph {
  constructor(data) {
    const nodes = this.nodes = [];
    const byName = this.byName = {};

    Object.keys(data).forEach(name => {
      const node = data[name];

      // normalize
      node.name = name;
      if (!node.dependencies) {
        node.dependencies = [];
      }

      if (node.done) {
        node.state = 'done';
      } else if (node.assigned) {
        // note that a work item can be inProgress even if it is blocked
        node.state = 'inProgress';
      } else {
        node.state = 'ready';
      }

      nodes.push(node);
      byName[name] = node;
    });

    // If any 'ready' tasks have dependencies that aren't in state 'done', then
    // they are actually blocked.
    nodes.forEach(_node => {
      const node = _node;
      if (node.state === 'ready') {
        if (node.dependencies.filter(d => byName[d].state !== 'done').length > 0) {
          node.state = 'blocked';
        }
      }
    });
  }

  // Return a new WorkGraph instance containing only the nodes on which
  // the given node depends
  subgraph(name) {
    const subgraph = {};
    const byName = this.byName;

    const recur = n => {
      if (subgraph[n]) {
        return;
      }

      const node = byName[n];
      subgraph[n] = node;
      node.dependencies.forEach(dep => recur(dep));
    };
    recur(name);

    return new WorkGraph(subgraph);
  }

  // Return a copy of this WorkGraph containing only the minimum edges required
  // to reach every node from the root.  This removes redundant "long" edges:
  // if A -> B -> C, then an edge from A -> C is redundant.  The effect is a
  // much simpler, almost tree-shaped visual display
  transitiveReduction() {
    // begin by making a reachability matrix
    const paths = new Set();
    const seen = new Set();
    const stack = [];

    // DFS through the graph, using a stack to get transitive reachability
    const recur = name => {
      seen.add(name);
      stack.forEach(n => paths.add(`${n}-${name}`));
      stack.push(name);
      this.byName[name].dependencies.forEach(recur);
      stack.pop();
    };

    this.nodes.forEach(node => {
      if (seen.has(node.name)) {
        return;
      }
      recur(node.name);
    });

    // now omit dependencies for which another dependency has a path
    const reduced = {};
    this.nodes.forEach(node => {
      const omit = new Set();

      node.dependencies.forEach(dep1 => {
        node.dependencies.forEach(dep2 => {
          if (dep1 !== dep2 && paths.has(`${dep2}-${dep1}`)) {
            // node -> dep2 --...--> dep1
            //      \______________/
            // so omit the longer edge from node1 -> dep1
            omit.add(dep1);
          }
        });
      });

      const dependencies = node.dependencies.filter(dep => !omit.has(dep));
      reduced[node.name] = { ...node, dependencies };
    });

    return new WorkGraph(reduced);
  }

  // Return the list of work items tagged as milestones
  milestones() {
    return this.nodes
      .filter(node => node.milestone);
  }

  // Calculate a start and end time, in days, for each node, based on
  // durations and dependencies.  Finished nodes are ignored.
  //
  // Options: {
  //   readyDelay: day count at which which "ready" tasks wil start
  //   defaultDuration: duration for nodes without one specified
  // }
  //
  // Returns: object mapping nodes to start and end times, given in
  // number of days from the start.
  calculateTimes({ readyDelay, defaultDuration }) {
    // first filter out the completed nodes
    const nodes = this.nodes.filter(node => !node.done);
    const byName = this.byName;

    // calculate start times (in days from startDate) based on dependencies
    const times = {};
    const queue = nodes.map(node => node.name);
    while (queue.length) {
      const node = byName[queue.pop()];
      if (!(node.name in times)) {
        const duration = typeof node.duration === 'number' ? node.duration : defaultDuration;

        if (node.dependencies.length) {
          let maxEnd = -1;
          let missingDep = false;
          for (const d of node.dependencies) {
            if (d in times) {
              const depEnd = times[d].end;
              maxEnd = maxEnd > depEnd ? maxEnd : depEnd;
            } else if (!byName[d].done) {
              queue.unshift(d);
              missingDep = true;
            }
          }

          if (maxEnd === -1) {
            maxEnd = readyDelay;
          }

          // if we didn't find all the dependencies, re-queue this node
          if (missingDep) {
            queue.unshift(node.name);
          } else {
            times[node.name] = { start: maxEnd, end: maxEnd + duration };
          }
        } else if (node.state === 'ready') {
          times[node.name] = { start: 0, end: duration };
        } else {
          times[node.name] = { start: readyDelay, end: duration + readyDelay };
        }
      }
    }

    return times;
  }

  // Calculate the "distance", counted as number of dependencies, of each node
  // from the root
  // TODO: instead calculate total critical-path duration
  rootDistances(root) {
    const distances = {};
    const stack = [{ node: root, distance: 0 }];

    while (stack.length) {
      const { node, distance } = stack.pop();

      // update distance, finding the minimum
      if (distance < (distances[node] || 9999)) {
        distances[node] = distance;
      }

      this.byName[node].dependencies.forEach(dep => {
        stack.push({ node: dep, distance: distance + 1 });
      });
    }

    return distances;
  }

  // Return the "reverse dependencies" of this node -- nodes that depend on it
  reverseDependencies(name) {
    return Array.from(
      this.nodes.reduce((res, node) => {
        if (node.dependencies.indexOf(name) !== -1) {
          res.add(node.name);
        }
        return res;
      }, new Set())
    );
  }
}
