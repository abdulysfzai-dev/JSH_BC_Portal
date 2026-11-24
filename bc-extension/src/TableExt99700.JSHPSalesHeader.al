// Portal fields on the sales order. The same field numbers are used on the posted shipment and
// invoice headers, so BC copies the values automatically when the order is posted.
tableextension 99700 "JSHP Sales Header" extends "Sales Header"
{
    fields
    {
        field(99700; "JSHP Portal Order Placed By"; Text[100])
        {
            Caption = 'Portal Order Placed By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
        }
        field(99701; "JSHP Portal Order Notes"; Text[250])
        {
            Caption = 'Portal Order Notes';
            DataClassification = CustomerContent;
            Editable = false;
        }
    }
}

tableextension 99701 "JSHP Sales Shipment Header" extends "Sales Shipment Header"
{
    fields
    {
        field(99700; "JSHP Portal Order Placed By"; Text[100])
        {
            Caption = 'Portal Order Placed By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
        }
        field(99701; "JSHP Portal Order Notes"; Text[250])
        {
            Caption = 'Portal Order Notes';
            DataClassification = CustomerContent;
            Editable = false;
        }
    }
}

tableextension 99702 "JSHP Sales Invoice Header" extends "Sales Invoice Header"
{
    fields
    {
        field(99700; "JSHP Portal Order Placed By"; Text[100])
        {
            Caption = 'Portal Order Placed By';
            DataClassification = EndUserIdentifiableInformation;
            Editable = false;
        }
        field(99701; "JSHP Portal Order Notes"; Text[250])
        {
            Caption = 'Portal Order Notes';
            DataClassification = CustomerContent;
            Editable = false;
        }
    }
}
