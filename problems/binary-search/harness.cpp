// Judge-mode harness: reads an array and a target from stdin, calls the
// binarySearch() defined in whichever translation unit it's linked against
// (student.cpp or reference.cpp), and prints the result.
//
// Input format:
//   n
//   a_0 a_1 ... a_{n-1}
//   target
//
// This is deliberately not instrumented. Autopsy-mode instrumentation is a
// separate build (Week 3-4 per the plan) that wraps the same source subset.

#include <iostream>
#include <vector>
using namespace std;
int binarySearch(const vector<int>& a, int target);

int main() {
    int n;
    if (!(cin>>n)) return 1;

    vector<int> a(n);
    for (int i = 0; i < n; ++i) {
        if (!(cin >> a[i])) return 1;
    }

    int target;
    if (!(cin>>target)) return 1;

    cout<<binarySearch(a, target)<<endl;
    return 0;
}
