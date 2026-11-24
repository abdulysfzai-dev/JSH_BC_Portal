// Add this permission set to the "JSH Trade Portal" app on the Microsoft Entra Applications page.
permissionset 99700 "JSHP PORTAL API"
{
    Caption = 'JSH Trade Portal API';
    Assignable = true;
    Permissions =
        tabledata "Sales Header" = RIM,
        tabledata "Sales Line" = RIM,
        page "JSHP Portal Sales Order API" = X,
        page "JSHP Portal Sales Line API" = X;
}
