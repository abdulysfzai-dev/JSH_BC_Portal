// For the portal's Entra app (Microsoft Entra Applications page): create and read portal orders.
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

// For JSH staff who invite customers, and for the job queue user that sends confirmations.
permissionset 99701 "JSHP PORTAL USER"
{
    Caption = 'JSH Trade Portal User';
    Assignable = true;
    Permissions =
        tabledata "JSHP Portal Setup" = R,
        tabledata "JSHP Portal Notification Log" = RI,
        codeunit "JSHP Portal Client" = X,
        codeunit "JSHP Confirm Notifier" = X,
        codeunit "JSHP Portal Invite" = X,
        page "JSHP Invite to Portal" = X,
        page "JSHP Portal Notification Log" = X;
}

// For whoever sets up the connection.
permissionset 99702 "JSHP PORTAL ADMIN"
{
    Caption = 'JSH Trade Portal Admin';
    Assignable = true;
    IncludedPermissionSets = "JSHP PORTAL USER";
    Permissions =
        tabledata "JSHP Portal Setup" = RIMD,
        tabledata "JSHP Portal Notification Log" = RIMD,
        page "JSHP Portal Setup" = X,
        page "JSHP Portal Key Dialog" = X;
}
