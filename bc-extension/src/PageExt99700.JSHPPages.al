// Shows the portal fields. Read-only, added at the end of existing groups, nothing moved or hidden.
pageextension 99700 "JSHP Sales Order" extends "Sales Order"
{
    layout
    {
        addlast(General)
        {
            field("JSHP Portal Order Placed By"; Rec."JSHP Portal Order Placed By")
            {
                ApplicationArea = All;
                ToolTip = 'Who placed this order in the JSH Trade Portal.';
            }
            field("JSHP Portal Order Notes"; Rec."JSHP Portal Order Notes")
            {
                ApplicationArea = All;
                MultiLine = true;
                ToolTip = 'Notes the customer entered with this order in the JSH Trade Portal.';
            }
        }
    }
}

pageextension 99701 "JSHP Sales Order List" extends "Sales Order List"
{
    layout
    {
        addlast(Control1)
        {
            field("JSHP Portal Order Placed By"; Rec."JSHP Portal Order Placed By")
            {
                ApplicationArea = All;
                Visible = false;
                ToolTip = 'Who placed this order in the JSH Trade Portal.';
            }
        }
    }
}

pageextension 99702 "JSHP Posted Sales Invoice" extends "Posted Sales Invoice"
{
    layout
    {
        addlast(General)
        {
            field("JSHP Portal Order Placed By"; Rec."JSHP Portal Order Placed By")
            {
                ApplicationArea = All;
                ToolTip = 'Who placed the order in the JSH Trade Portal.';
            }
            field("JSHP Portal Order Notes"; Rec."JSHP Portal Order Notes")
            {
                ApplicationArea = All;
                MultiLine = true;
                ToolTip = 'Notes the customer entered with the order in the JSH Trade Portal.';
            }
        }
    }
}

pageextension 99703 "JSHP Posted Sales Shipment" extends "Posted Sales Shipment"
{
    layout
    {
        addlast(General)
        {
            field("JSHP Portal Order Placed By"; Rec."JSHP Portal Order Placed By")
            {
                ApplicationArea = All;
                ToolTip = 'Who placed the order in the JSH Trade Portal.';
            }
            field("JSHP Portal Order Notes"; Rec."JSHP Portal Order Notes")
            {
                ApplicationArea = All;
                MultiLine = true;
                ToolTip = 'Notes the customer entered with the order in the JSH Trade Portal.';
            }
        }
    }
}
