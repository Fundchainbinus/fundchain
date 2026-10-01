# Role & Permission Matrix

  Feature                   Student/Creator   Student/Donor          Admin
  ----------------------- ----------------- --------------- --------------
  Login                                 Yes             Yes            Yes
  View Active Campaign                  Yes             Yes            Yes
  Create Campaign                       Yes           Yes\*            Yes
  Edit Own Campaign                     Yes           Yes\*             No
  Submit Campaign                       Yes           Yes\*             No
  View Review Queue                      No              No            Yes
  Approve Campaign                       No              No            Yes
  Reject Campaign                        No              No            Yes
  Donate                                Yes             Yes            Yes
  View Donation History                 Own             Own            All
  View Blockchain Proof                 Yes             Yes            Yes
  Run Integrity Check               Limited              No            Yes
  View Audit Logs               Own related     Own related            All
  Request Disbursement                  Yes              No             No
  Approve Disbursement                   No              No            Yes
  Freeze Campaign                        No              No   System/Admin
  Unfreeze Campaign                      No              No            Yes

\* Karena satu mahasiswa dapat menjadi Creator sekaligus Donor.

## Permission Naming

``` text
campaign:create
campaign:read
campaign:update:own
campaign:submit

campaign:review
campaign:approve
campaign:reject

donation:create
donation:read:own
donation:read:all

integrity:verify

disbursement:create
disbursement:approve
disbursement:reject

audit:read
```
