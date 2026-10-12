/** 原型用的示例正文：一份 Markdown 笔记 + 一份代码文件 */

export const SAMPLE_MD = `# 第 06 讲 · 平衡二叉树与 AVL

> 本次课重点：二叉排序树的退化问题，以及 AVL 树如何用「旋转」把树高压回 O(log n)。
> 老师说期末必考 **四种旋转**，一定要能手画出来。

## 1. 为什么需要平衡

普通二叉排序树的查找效率取决于树高。当插入序列本身有序时，树会退化成链表：

| 插入序列 | 树高 | 查找复杂度 |
| --- | --- | --- |
| 4, 2, 6, 1, 3, 5, 7 | 3 | O(log n) |
| 1, 2, 3, 4, 5, 6, 7 | 7 | O(n) |

**平衡因子 BF** = 左子树高度 − 右子树高度。AVL 树要求每个结点的 |BF| ≤ 1。

## 2. 四种旋转

1. **LL 型** — 在左子树的左侧插入，做一次右旋
2. **RR 型** — 在右子树的右侧插入，做一次左旋
3. **LR 型** — 先对左子树左旋，再对根右旋
4. **RL 型** — 先对右子树右旋，再对根左旋

### 右旋的实现

\`\`\`cpp
// 以 p 为轴做右旋，返回新的子树根
Node* rotateRight(Node* p) {
    Node* l = p->left;
    p->left = l->right;      // l 的右子树挂到 p 的左边
    l->right = p;            // p 成为 l 的右孩子
    updateHeight(p);         // 先更新 p，再更新 l
    updateHeight(l);
    return l;
}
\`\`\`

### 插入后的修复逻辑

\`\`\`python
def rebalance(node):
    update_height(node)
    bf = balance_factor(node)
    if bf > 1:                      # 左边偏高
        if balance_factor(node.left) < 0:
            node.left = rotate_left(node.left)   # LR：先左旋
        return rotate_right(node)                # 再右旋
    if bf < -1:                     # 右边偏高
        if balance_factor(node.right) > 0:
            node.right = rotate_right(node.right)  # RL：先右旋
        return rotate_left(node)                   # 再左旋
    return node
\`\`\`

## 3. 易错点（错题本摘录）

- [x] BF 定义成「右 − 左」还是「左 − 右」要和代码里的判断保持一致
- [x] 旋转后**只有两个结点**的高度会变，不要整棵树重算
- [ ] 删除结点可能需要**连续多次**旋转，一路回溯到根
- [ ] AVL 只是"高度平衡"，不保证左右子树结点数相近

> 复习建议：拿 7 个关键字手画一遍 LL / RR / LR / RL，比看十遍代码有用。

---

### 与红黑树的对比

AVL 更严格（树高更小，查找更快），但插入删除的旋转次数更多；
红黑树放宽到「最长路径不超过最短路径的两倍」，换来更少的旋转，
所以 \`std::map\`、Java 的 \`TreeMap\` 都选了红黑树。
`

export const SAMPLE_CODE = `// graph_dijkstra.cpp —— 数据结构 实验三：单源最短路径
#include <iostream>
#include <vector>
#include <queue>
#include <climits>

using namespace std;

const int INF = INT_MAX / 2;

struct Edge {
    int to;
    int weight;
};

// 邻接表存图：graph[u] 保存 u 的所有出边
vector<vector<Edge>> graph;

vector<int> dijkstra(int src, int n) {
    vector<int> dist(n, INF);
    // 小根堆：pair<距离, 结点编号>
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<>> pq;

    dist[src] = 0;
    pq.push({0, src});

    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();

        if (d > dist[u]) continue;   // 过期条目，跳过

        for (const Edge& e : graph[u]) {
            if (dist[u] + e.weight < dist[e.to]) {
                dist[e.to] = dist[u] + e.weight;
                pq.push({dist[e.to], e.to});
            }
        }
    }
    return dist;
}

int main() {
    int n = 6, m = 9;
    graph.assign(n, {});

    // 样例：6 个结点 9 条有向边
    vector<tuple<int, int, int>> edges = {
        {0, 1, 4}, {0, 2, 2}, {1, 2, 5}, {1, 3, 10},
        {2, 4, 3}, {4, 3, 4}, {3, 5, 11}, {4, 5, 9}, {2, 3, 8}
    };
    for (auto [u, v, w] : edges) graph[u].push_back({v, w});

    vector<int> dist = dijkstra(0, n);
    for (int i = 0; i < n; ++i) {
        cout << "dist[0 -> " << i << "] = " << dist[i] << endl;
    }
    return 0;
}
`

export const SAMPLE_DOCX = {
  title: '作业 3 · 图的最短路径',
  meta: '数据结构与算法 · 陈立群 · 提交于 2025-10-28 09:12',
  sections: [
    {
      h: '一、实验目的',
      p: '掌握 Dijkstra 与 Bellman-Ford 两种单源最短路径算法的适用条件，理解为何 Dijkstra 不能处理负权边，并用邻接表实现一个可在 O((V+E) log V) 时间内完成的版本。',
    },
    {
      h: '二、算法设计',
      p: '采用邻接表存储有向图，配合小根堆（优先队列）实现松弛操作。每次从堆中取出当前距离最小的结点，若该距离已过期则直接跳过；否则遍历其所有出边进行松弛，并将更新后的距离压入堆中。',
    },
    {
      h: '三、测试数据与结果',
      p: '使用 6 个结点、9 条有向边的样例图，以 0 号结点为源点。运行结果为 dist = [0, 4, 2, 9, 5, 14]，与手工推导一致。当把 {1, 2} 边的权值改为 −5 后，算法给出的结果出现错误，验证了 Dijkstra 对负权边不适用。',
    },
    {
      h: '四、复杂度分析',
      p: '外层循环至多执行 V 次，每次堆操作 O(log V)；内层遍历所有边共 E 次，每次可能压堆一次。总时间复杂度 O((V + E) log V)，空间复杂度 O(V + E)。',
    },
  ],
}
