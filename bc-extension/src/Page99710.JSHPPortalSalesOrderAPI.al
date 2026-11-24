// Portal sales order API: create a sales order (header + lines in one call) and read order status.
// URL: /api/JSHealth/portal/v1.0/companies({id})/portalSalesOrders
// Create only. Modify and delete are switched off, so the portal can never change or remove an order.
page 99710 "JSHP Portal Sales Order API"
{
    PageType = API;
    APIPublisher = 'JSHealth';
    APIGroup = 'portal';
    APIVersion = 'v1.0';
    EntityName = 'portalSalesOrder';
    EntitySetName = 'portalSalesOrders';
    EntityCaption = 'Portal Sales Order';
    EntitySetCaption = 'Portal Sales Orders';
    SourceTable = "Sales Header";
    SourceTableView = where("Document Type" = const(Order));
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = true;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Caption = 'Id'; Editable = false; }
                field(number; Rec."No.") { Caption = 'No.'; Editable = false; }
                field(customerNumber; CustomerNo) { Caption = 'Customer No.'; }
                field(customerName; Rec."Sell-to Customer Name") { Caption = 'Customer Name'; Editable = false; }
                field(orderDate; OrderDate) { Caption = 'Order Date'; }
                field(requestedDeliveryDate; RequestedDeliveryDate) { Caption = 'Requested Delivery Date'; }
                field(externalDocumentNumber; ExternalDocNo) { Caption = 'External Document No.'; }
                field(yourReference; YourReference) { Caption = 'Your Reference'; }
                field(portalOrderPlacedBy; PlacedBy) { Caption = 'Portal Order Placed By'; }
                field(portalOrderNotes; PortalNotes) { Caption = 'Portal Order Notes'; }
                field(status; StatusText) { Caption = 'Status'; Editable = false; }
                field(orderReviewed; OrderReviewedText) { Caption = 'Order Reviewed'; Editable = false; }
                field(amountIncludingVAT; Rec."Amount Including VAT") { Caption = 'Amount Including Tax'; Editable = false; }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Caption = 'Last Modified Date Time'; Editable = false; }
                part(portalSalesOrderLines; "JSHP Portal Sales Line API")
                {
                    Caption = 'Lines';
                    EntityName = 'portalSalesOrderLine';
                    EntitySetName = 'portalSalesOrderLines';
                    SubPageLink = "Document Type" = field("Document Type"), "Document No." = field("No.");
                }
            }
        }
    }

    var
        CustomerNo: Code[20];
        OrderDate: Date;
        RequestedDeliveryDate: Date;
        ExternalDocNo: Code[35];
        YourReference: Text[35];
        PlacedBy: Text[100];
        PortalNotes: Text[250];
        StatusText: Text[30];
        OrderReviewedText: Text[50];
        OrderReviewedFieldNo: Integer;
        CustomerRequiredErr: Label 'customerNumber is required.';

    trigger OnOpenPage()
    begin
        // "Order Reviewed" belongs to the JSHealthXero extension (Sales Header field 50031).
        // It is read by number, so this extension has no dependency on JSHealthXero.
        OrderReviewedFieldNo := 50031;
    end;

    trigger OnAfterGetRecord()
    begin
        CustomerNo := Rec."Sell-to Customer No.";
        OrderDate := Rec."Order Date";
        RequestedDeliveryDate := Rec."Requested Delivery Date";
        ExternalDocNo := Rec."External Document No.";
        YourReference := Rec."Your Reference";
        PlacedBy := Rec."JSHP Portal Order Placed By";
        PortalNotes := Rec."JSHP Portal Order Notes";
        StatusText := Format(Rec.Status);
        OrderReviewedText := GetOrderReviewed();
    end;

    trigger OnNewRecord(BelowxRec: Boolean)
    begin
        Clear(CustomerNo); Clear(OrderDate); Clear(RequestedDeliveryDate); Clear(ExternalDocNo);
        Clear(YourReference); Clear(PlacedBy); Clear(PortalNotes);
    end;

    // Builds the order the same way a user would on the Sales Order page: insert with the number series,
    // then validate the customer (which brings in addresses, terms, prices), then the other fields.
    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    begin
        if CustomerNo = '' then
            Error(CustomerRequiredErr);
        Rec.Init();
        Rec."Document Type" := Rec."Document Type"::Order;
        Rec."No." := '';
        Rec.Insert(true);
        Rec.Validate("Sell-to Customer No.", CustomerNo);
        if OrderDate <> 0D then
            Rec.Validate("Order Date", OrderDate);
        if RequestedDeliveryDate <> 0D then
            Rec.Validate("Requested Delivery Date", RequestedDeliveryDate);
        Rec.Validate("External Document No.", ExternalDocNo);
        Rec.Validate("Your Reference", YourReference);
        Rec."JSHP Portal Order Placed By" := PlacedBy;
        Rec."JSHP Portal Order Notes" := PortalNotes;
        Rec.Modify(true);
        StatusText := Format(Rec.Status);
        OrderReviewedText := GetOrderReviewed();
        exit(false);
    end;

    local procedure GetOrderReviewed(): Text[50]
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
    begin
        if OrderReviewedFieldNo = 0 then
            OrderReviewedFieldNo := 50031;
        RecRef.GetTable(Rec);
        if not RecRef.FieldExist(OrderReviewedFieldNo) then
            exit('');
        FldRef := RecRef.Field(OrderReviewedFieldNo);
        exit(CopyStr(Format(FldRef.Value), 1, 50));
    end;
}
