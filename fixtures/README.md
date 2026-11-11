# fixtures/sheet — SYNTHETIC reconstruction (not Madtown data)

The requirements describe the Google Sheet "Inventory: Madtown" but only quote ~17 of its 103 rows. `make_fixture.py`
rebuilds the three tabs so that every statistic and data-quality quirk stated in the spec holds (sections 4.2, 6.2, 11, Appendix A/C):
103 rows MTMH_101–203; Condition Good 82 / Bad condition 8 / Lost 5 / Repairing 1 / blank 7; Posession counts; 44 Accessory and 17
"Light accessory " (+1 without the space); 15 trailing-space names; double spaces in 107/108; MTMH_145 ID trailing space; 43 model numbers;
folder links on 101, 102, 103, 110, 112, 119; 10 rows without stock image; 11 text values in Updated links; etc. The script asserts these.

Rows the spec describes keep the documented names and notes. All other rows are named "Synthetic …". Prices in To buy notes are synthetic
and marked as such. There is no personal contact data.

**Before sign-off:** export the real tabs (File → Download → CSV), run a dry-run in Import review, resolve warnings with Naveen and Anand
(record decisions as mapping rules), and re-run the acceptance tests (DECISIONS D-34).
