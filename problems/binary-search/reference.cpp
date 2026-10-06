#include <bits/stdc++.h>
using namespace std;

int binarySearch(const vector<int>& a, int target) {
    int left = 0;
    int right = (int)a.size() - 1;

    while (left <= right) {  // correct inclusive-interval guard
        int mid = left + (right - left) / 2;

        if (a[mid] == target)
            return mid;

        if (a[mid] < target)
            left = mid + 1;
        else
            right = mid - 1;
    }

    return -1;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    if (!(cin >> n)) return 0;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];
    int target;
    cin >> target;

    cout << binarySearch(a, target) << "\n";
    return 0;
}
